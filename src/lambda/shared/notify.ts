/**
 * Package review notifications.
 *
 * The review loop has two waits in it: an admin waiting to learn something was
 * uploaded, and an uploader waiting to learn what was decided. Without a nudge
 * both are polling a page, and a rejected upload is silent — the user never
 * finds out why.
 *
 * Delivery is deliberately best-effort. A failed email must never fail the
 * approval it is reporting on, so every function here swallows its errors after
 * logging them.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ADMIN_GROUP } from './auth';

const ses = new SESClient({});
const cognito = new CognitoIdentityProviderClient({});

const FROM_EMAIL = process.env.SES_FROM_EMAIL || '';
const USER_POOL_ID = process.env.USER_POOL_ID || '';
const CONSOLE_URL = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');

/** Cap the fan-out so a large admin group cannot turn one upload into a storm. */
const MAX_ADMIN_RECIPIENTS = 20;

async function send(to: string[], subject: string, body: string): Promise<void> {
  const recipients = to.filter((address) => /.+@.+/.test(address));
  if (recipients.length === 0) return;
  if (!FROM_EMAIL) {
    console.log('SES_FROM_EMAIL is not configured; skipping notification:', subject);
    return;
  }

  try {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: recipients },
        Message: {
          Subject: { Data: subject },
          Body: { Text: { Data: body } },
        },
      })
    );
  } catch (error) {
    console.error('Failed to send notification email:', error);
  }
}

/** Email addresses of the admin group, for review-queue notifications. */
async function adminEmails(): Promise<string[]> {
  if (!USER_POOL_ID) return [];
  try {
    const res = await cognito.send(
      new ListUsersInGroupCommand({
        UserPoolId: USER_POOL_ID,
        GroupName: ADMIN_GROUP,
        Limit: MAX_ADMIN_RECIPIENTS,
      })
    );
    return (res.Users || [])
      .map((user) => user.Attributes?.find((a) => a.Name === 'email')?.Value)
      .filter((email): email is string => Boolean(email));
  } catch (error) {
    console.error('Could not list admins for notification:', error);
    return [];
  }
}

function reviewLink(): string {
  return CONSOLE_URL ? `\n\nReview queue: ${CONSOLE_URL}/admin` : '';
}

/** Tell the admins a package has finished analysis and is waiting on them. */
export async function notifyPackageAwaitingReview(pkg: {
  name: string;
  fileName?: string;
  uploadedBy?: string;
  confidence?: string;
  installerType?: string;
}): Promise<void> {
  const admins = await adminEmails();
  if (admins.length === 0) return;

  const detail = pkg.installerType
    ? `Detected as ${pkg.installerType}${pkg.confidence ? ` (${pkg.confidence} confidence)` : ''}.`
    : 'Automatic analysis did not identify the installer type.';

  await send(
    admins,
    `Package awaiting review: ${pkg.name}`,
    `${pkg.uploadedBy || 'A user'} uploaded "${pkg.name}"${
      pkg.fileName ? ` (${pkg.fileName})` : ''
    } and it is waiting for approval.\n\n${detail}\n\n` +
      'It cannot be installed on any workstation until an administrator approves it.' +
      reviewLink()
  );
}

/** Tell the uploader what an admin decided. */
export async function notifyUploaderOfDecision(input: {
  uploadedBy?: string;
  packageName: string;
  decision: 'approved' | 'rejected';
  reviewedBy?: string;
  notes?: string;
}): Promise<void> {
  if (!input.uploadedBy) return;

  const approved = input.decision === 'approved';
  const subject = approved
    ? `Your package was approved: ${input.packageName}`
    : `Your package was not approved: ${input.packageName}`;

  let body = approved
    ? `"${input.packageName}" has been approved and can now be selected when launching a workstation.\n`
    : `"${input.packageName}" was not approved, and the uploaded installer has been deleted.\n`;

  if (input.notes) {
    body += `\nReviewer notes: ${input.notes}\n`;
  }
  if (input.reviewedBy) {
    body += `\nReviewed by ${input.reviewedBy}.\n`;
  }
  if (!approved) {
    body += '\nYou can upload a corrected installer if this was a mistake.';
  }

  await send([input.uploadedBy], subject, body);
}

/** Tell the uploader their upload could not be analyzed automatically. */
export async function notifyUploaderOfAnalysisFailure(input: {
  uploadedBy?: string;
  packageName: string;
  reason: string;
}): Promise<void> {
  if (!input.uploadedBy) return;

  await send(
    [input.uploadedBy],
    `Analysis failed: ${input.packageName}`,
    `"${input.packageName}" uploaded successfully, but it could not be identified automatically.\n\n` +
      `${input.reason}\n\n` +
      'An administrator will need to set the install parameters by hand before it can be approved.'
  );
}
