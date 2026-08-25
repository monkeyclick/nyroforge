#!/usr/bin/env node
'use strict';

/**
 * Backfill expectedSha256 for URL-based bootstrap packages.
 *
 * Uploaded packages always carry a server-computed hash, but packages entered
 * as a plain downloadUrl predate that and mostly have none. While any package
 * lacks a hash, `Security:RequirePackageHash` on the installer service has to
 * stay false — which means every package without one installs unverified.
 *
 * This downloads each hashless package over HTTPS, computes SHA-256 by
 * streaming (nothing is held in memory or written to disk), and writes it back
 * to the catalog. Then flip RequirePackageHash to true in appsettings.json so
 * the service fails closed.
 *
 *   node scripts/backfill-package-hashes.js            # report only
 *   node scripts/backfill-package-hashes.js --write    # compute and persist
 *   node scripts/backfill-package-hashes.js --write --package-id pkg-foo
 *
 * Environment:
 *   BOOTSTRAP_PACKAGES_TABLE  catalog table (default WorkstationBootstrapPackages)
 *   AWS_REGION                region for the DynamoDB client
 */

const crypto = require('crypto');
const https = require('https');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const BOOTSTRAP_TABLE =
  process.env.BOOTSTRAP_PACKAGES_TABLE || 'WorkstationBootstrapPackages';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ONLY_PACKAGE = (() => {
  const i = args.indexOf('--package-id');
  return i >= 0 ? args[i + 1] : null;
})();

/** Follow redirects (vendors redirect to CDNs constantly) up to a sane depth. */
const MAX_REDIRECTS = 5;

function hashUrl(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 120000 }, (response) => {
      const status = response.statusCode || 0;

      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        const next = new URL(response.headers.location, url).toString();
        resolve(hashUrl(next, redirectsLeft - 1));
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }

      const hash = crypto.createHash('sha256');
      let bytes = 0;
      response.on('data', (chunk) => {
        hash.update(chunk);
        bytes += chunk.length;
      });
      response.on('end', () => resolve({ sha256: hash.digest('hex'), bytes }));
      response.on('error', reject);
    });

    request.on('timeout', () => request.destroy(new Error('Download timed out')));
    request.on('error', reject);
  });
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes || 1) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

async function scanAll() {
  const items = [];
  let lastKey;
  do {
    const res = await docClient.send(
      new ScanCommand({ TableName: BOOTSTRAP_TABLE, ExclusiveStartKey: lastKey })
    );
    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function main() {
  console.log(`Reading ${BOOTSTRAP_TABLE}…`);
  const packages = await scanAll();

  const candidates = packages.filter((pkg) => {
    if (pkg.expectedSha256) return false;
    if (ONLY_PACKAGE && pkg.packageId !== ONLY_PACKAGE) return false;
    // Uploaded packages are hashed by the analyzer; only URL ones need this.
    if (pkg.source === 's3') return false;
    return typeof pkg.downloadUrl === 'string' && pkg.downloadUrl.startsWith('https://');
  });

  const skipped = packages.filter(
    (pkg) => !pkg.expectedSha256 && pkg.source !== 's3' && !candidates.includes(pkg)
  );

  console.log(`${packages.length} packages, ${candidates.length} missing a hash and hashable.`);
  if (skipped.length > 0) {
    console.log(`\n${skipped.length} cannot be hashed automatically (no HTTPS downloadUrl):`);
    for (const pkg of skipped) {
      console.log(`  - ${pkg.packageId} (${pkg.name}): ${pkg.downloadUrl || 'no URL'}`);
    }
  }

  if (!WRITE) {
    console.log('\nDry run. Re-run with --write to download, hash and persist.');
    for (const pkg of candidates) {
      console.log(`  would hash ${pkg.packageId} (${pkg.name}) ← ${pkg.downloadUrl}`);
    }
    return;
  }

  let succeeded = 0;
  const failures = [];

  for (const pkg of candidates) {
    process.stdout.write(`Hashing ${pkg.name}… `);
    try {
      const { sha256, bytes } = await hashUrl(pkg.downloadUrl);
      await docClient.send(
        new UpdateCommand({
          TableName: BOOTSTRAP_TABLE,
          Key: { packageId: pkg.packageId },
          UpdateExpression: 'SET expectedSha256 = :hash, updatedAt = :now',
          ExpressionAttributeValues: {
            ':hash': sha256,
            ':now': new Date().toISOString(),
          },
        })
      );
      console.log(`${sha256.slice(0, 16)}… (${formatBytes(bytes)})`);
      succeeded += 1;
    } catch (error) {
      console.log(`FAILED — ${error.message}`);
      failures.push({ packageId: pkg.packageId, name: pkg.name, error: error.message });
    }
  }

  console.log(`\nHashed ${succeeded} of ${candidates.length}.`);

  const stillMissing = failures.length + skipped.length;
  if (stillMissing === 0) {
    console.log(
      'Every package now has a hash. Set Security:RequirePackageHash to true in\n' +
        'src/windows-service/WorkstationPackageInstaller/appsettings.json and redeploy\n' +
        'the installer service so it fails closed on unverifiable artifacts.'
    );
  } else {
    console.log(
      `${stillMissing} package(s) still have no hash. RequirePackageHash must stay false\n` +
        'until each is hashed, replaced with an upload, or removed:'
    );
    for (const f of failures) {
      console.log(`  - ${f.packageId} (${f.name}): ${f.error}`);
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
