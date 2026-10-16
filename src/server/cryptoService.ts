import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits

function getEncryptionKey(): Buffer {
  const secret = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.trim() === '') {
    throw new Error(
      'INSTAGRAM_TOKEN_ENCRYPTION_KEY server-side environment variable is not configured.'
    );
  }

  // If secret is hex or base64 or raw string, normalize to 32 bytes buffer
  let keyBuffer: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    keyBuffer = Buffer.from(secret, 'hex');
  } else {
    // Hash or pad/truncate to 32 bytes securely using sha256
    keyBuffer = crypto.createHash('sha256').update(secret).digest();
  }

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error('Encryption key must resolve to exactly 32 bytes.');
  }

  return keyBuffer;
}

export interface EncryptedTokenResult {
  encryptedData: string; // format: iv:authTag:ciphertext (hex)
}

export function encryptAccessToken(plainToken: string): string {
  if (!plainToken || typeof plainToken !== 'string') {
    throw new Error('Access token to encrypt must be a non-empty string.');
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainToken, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  // Return formatted string: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptAccessToken(encryptedData: string): string {
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new Error('Encrypted data must be a valid formatted string.');
  }

  const key = getEncryptionKey();

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format.');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!/^[0-9a-fA-F]{24}$/.test(ivHex)) {
    throw new Error('Invalid IV format or length. Expected 12-byte hex string.');
  }
  if (!/^[0-9a-fA-F]{32}$/.test(authTagHex)) {
    throw new Error('Invalid authentication tag format or length. Expected 16-byte hex string.');
  }
  if (!ciphertextHex || !/^[0-9a-fA-F]+$/.test(ciphertextHex)) {
    throw new Error('Invalid ciphertext format. Expected hex string.');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
