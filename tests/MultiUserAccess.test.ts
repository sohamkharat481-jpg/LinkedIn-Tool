import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSignedTestToken,
  verifyServerAuthToken,
  isEmailAuthorized
} from '../src/server/serverAuthService';

test('1. Two authorized accounts (anjanapadhi21@gmail.com and sohamkharat481@gmail.com) are accepted', async () => {
  assert.equal(isEmailAuthorized('anjanapadhi21@gmail.com'), true);
  assert.equal(isEmailAuthorized('sohamkharat481@gmail.com'), true);
  assert.equal(isEmailAuthorized('ANJANAPADHI21@GMAIL.COM'), true);
  assert.equal(isEmailAuthorized('SohamKharat481@gmail.com'), true);

  const tokenAnjana = createSignedTestToken({
    userId: 'user-anjana',
    email: 'anjanapadhi21@gmail.com'
  });
  const resAnjana = await verifyServerAuthToken({
    headers: { authorization: `Bearer ${tokenAnjana}` }
  });
  assert.equal(resAnjana.status, 200);
  assert.equal(resAnjana.user?.email, 'anjanapadhi21@gmail.com');

  const tokenSoham = createSignedTestToken({
    userId: 'user-soham',
    email: 'sohamkharat481@gmail.com'
  });
  const resSoham = await verifyServerAuthToken({
    headers: { authorization: `Bearer ${tokenSoham}` }
  });
  assert.equal(resSoham.status, 200);
  assert.equal(resSoham.user?.email, 'sohamkharat481@gmail.com');
});

test('2. Any valid user account can sign up and log in (public access)', async () => {
  assert.equal(isEmailAuthorized('newuser@gmail.com'), true);
  assert.equal(isEmailAuthorized('anyuser@yahoo.com'), true);

  const tokenNewUser = createSignedTestToken({
    userId: 'user-new',
    email: 'newuser@gmail.com'
  });
  const resNewUser = await verifyServerAuthToken({
    headers: { authorization: `Bearer ${tokenNewUser}` }
  });
  assert.equal(resNewUser.status, 200);
  assert.equal(resNewUser.user?.email, 'newuser@gmail.com');
});

test('3. Unauthenticated requests are rejected with 401', async () => {
  const resMissing = await verifyServerAuthToken({});
  assert.equal(resMissing.status, 401);
  assert.match(resMissing.error || '', /Authentication required/i);
});

test('4. RS256 Firebase token verification rejects mismatched audience or issuer', async () => {
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-kid' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify({
    iss: 'https://securetoken.google.com/wrong-project',
    aud: 'wrong-project',
    sub: 'user-123',
    email: 'anjanapadhi21@gmail.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  })).toString('base64url');
  const fakeToken = `${headerB64}.${payloadB64}.fakesignature`;

  const res = await verifyServerAuthToken({
    headers: { authorization: `Bearer ${fakeToken}` }
  });
  assert.equal(res.status, 401);
  assert.match(res.error || '', /audience or issuer does not match/i);
});

