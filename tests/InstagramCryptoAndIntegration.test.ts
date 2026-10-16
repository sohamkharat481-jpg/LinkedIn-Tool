import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptAccessToken, decryptAccessToken } from '../src/server/cryptoService';

const originalEncryptionKey = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;

test.afterEach(() => {
  if (originalEncryptionKey === undefined) {
    delete process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
  }
});

test('encrypts and decrypts Instagram access tokens successfully using AES-256-GCM', () => {
  process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = 'test-secret-encryption-key-32-bytes-long!!';
  const token = 'IGQVJWW...test_token_secret_123';

  const encrypted = encryptAccessToken(token);
  assert.notEqual(encrypted, token);
  assert.equal(typeof encrypted, 'string');
  assert.equal(encrypted.split(':').length, 3); // iv:authTag:ciphertext

  const decrypted = decryptAccessToken(encrypted);
  assert.equal(decrypted, token);
});

test('throws error when encryption key is missing', () => {
  delete process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
  const token = 'IGQVJWW...test_token_secret_123';

  assert.throws(() => {
    encryptAccessToken(token);
  }, /INSTAGRAM_TOKEN_ENCRYPTION_KEY/);

  assert.throws(() => {
    decryptAccessToken('iv:tag:ciphertext');
  }, /INSTAGRAM_TOKEN_ENCRYPTION_KEY/);
});

test('throws error on invalid encrypted format or tampered ciphertext', () => {
  process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = 'test-secret-encryption-key-32-bytes-long!!';
  const token = 'secret-token';
  const encrypted = encryptAccessToken(token);

  const parts = encrypted.split(':');
  const tampered = `${parts[0]}:${parts[1]}:deadbeef`;

  assert.throws(() => {
    decryptAccessToken(tampered);
  });

  assert.throws(() => {
    decryptAccessToken('invalidformat');
  }, /Invalid encrypted data format/);
});
