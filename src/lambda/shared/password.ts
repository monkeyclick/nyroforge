import * as crypto from 'crypto';

/**
 * Generate a cryptographically random password containing at least one
 * uppercase letter, lowercase letter, number, and special character.
 * Ambiguous characters (I, l, O, 0, 1) are excluded from the charsets.
 */
export function generateSecurePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghjkmnpqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%^&*';

  const allChars = uppercase + lowercase + numbers + special;

  // Ensure at least one of each type
  const randomBytes = crypto.randomBytes(length);
  let password = '';
  password += uppercase[randomBytes[0] % uppercase.length];
  password += lowercase[randomBytes[1] % lowercase.length];
  password += numbers[randomBytes[2] % numbers.length];
  password += special[randomBytes[3] % special.length];

  for (let i = 4; i < length; i++) {
    password += allChars[randomBytes[i] % allChars.length];
  }

  // Shuffle the password using Fisher-Yates
  const arr = password.split('');
  const shuffleBytes = crypto.randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.join('');
}
