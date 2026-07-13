//------------------------------------------------------------------------------
// Crypto Service - Encryption-at-rest for secret material (WebCrypto/SubtleCrypto)
//
// Secret credential material (AWS secret access keys and session tokens) is
// encrypted with AES-256-GCM using a key derived from a user-supplied passphrase
// via PBKDF2 (SHA-256). Every encryption uses a fresh random salt and IV so that
// only ciphertext + salt + IV is ever written to disk - never the plaintext.
//------------------------------------------------------------------------------

import type { EncryptedPayload } from '../types';

// PBKDF2 / AES-GCM parameters
const PBKDF2_ITERATIONS = 210000; // >= 100k (OWASP 2023 guidance for PBKDF2-HMAC-SHA256)
const PBKDF2_HASH = 'SHA-256';
const SALT_BYTES = 16; // 128-bit random salt, per profile
const IV_BYTES = 12; // 96-bit nonce, recommended for AES-GCM
const AES_KEY_LENGTH = 256; // AES-256
const PAYLOAD_VERSION = 1;

//------------------------------------------------------------------------------
// Base64 helpers (matching the byte<->base64 style used in checksumService)
//------------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

// Return type intentionally left to inference so it resolves to an
// ArrayBuffer-backed Uint8Array (required by SubtleCrypto's BufferSource).
function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// UTF-8 encode into a fresh, ArrayBuffer-backed buffer so it satisfies
// SubtleCrypto's BufferSource (TextEncoder output is ArrayBufferLike-backed).
function encodeUtf8(text: string) {
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

//------------------------------------------------------------------------------
// Key derivation
//------------------------------------------------------------------------------

async function deriveKey(
  passphrase: string,
  salt: BufferSource,
  iterations: number
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encodeUtf8(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

//------------------------------------------------------------------------------
// Encrypt / Decrypt strings
//------------------------------------------------------------------------------

export async function encryptString(
  plaintext: string,
  passphrase: string
): Promise<EncryptedPayload> {
  if (!passphrase) {
    throw new Error('A passphrase is required to encrypt secrets');
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encodeUtf8(plaintext)
  );

  return {
    version: PAYLOAD_VERSION,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2',
    hash: PBKDF2_HASH,
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bufferToBase64(ciphertext),
  };
}

export async function decryptString(
  payload: EncryptedPayload,
  passphrase: string
): Promise<string> {
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const key = await deriveKey(passphrase, salt, payload.iterations);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      base64ToBytes(payload.ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // AES-GCM authentication failure -> wrong passphrase or tampered data
    throw new Error('Incorrect passphrase or corrupted credential data');
  }
}

//------------------------------------------------------------------------------
// Secret material helpers (AWS secret access key + session token)
//------------------------------------------------------------------------------

export interface SecretMaterial {
  secretAccessKey?: string;
  sessionToken?: string;
}

export async function encryptSecret(
  secret: SecretMaterial,
  passphrase: string
): Promise<EncryptedPayload> {
  return encryptString(JSON.stringify(secret), passphrase);
}

export async function decryptSecret(
  payload: EncryptedPayload,
  passphrase: string
): Promise<SecretMaterial> {
  const json = await decryptString(payload, passphrase);
  return JSON.parse(json) as SecretMaterial;
}
