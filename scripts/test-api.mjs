import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const BASE = process.env.TEST_API_URL
  ?? 'http://127.0.0.1:3000/api/v1';

const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');

let passed = 0;
let failed = 0;

let userA;
let userB;
let tokenA;
let tokenB;
let refreshA;
let friendshipId;

async function request(method, path, body, token) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined
      ? undefined
      : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    status: response.status,
    data,
  };
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${name}`);
  } catch (error) {
    failed++;
    console.error(`\x1b[31m[FAIL]\x1b[0m ${name}`);
    console.error(error.message);
  }
}

console.log('');
console.log('========================================');
console.log('       MIKOSCHAT INTEGRATION TESTS');
console.log('========================================');
console.log(`API: ${BASE}`);
console.log(`Test run: ${suffix}`);
console.log('');

await test('API health check', async () => {
  const r = await request('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'online');
});

await test('Register user A', async () => {
  const r = await request('POST', '/auth/register', {
    username: `test_a_${suffix}`,
    email: `test_a_${suffix}@example.com`,
    displayName: 'Test User A',
    password,
  });

  assert.equal(r.status, 201);
  userA = r.data.user;
  tokenA = r.data.accessToken;
  refreshA = r.data.refreshToken;
  assert.ok(userA.id);
  assert.ok(tokenA);
  assert.ok(refreshA);
});

await test('Register user B', async () => {
  const r = await request('POST', '/auth/register', {
    username: `test_b_${suffix}`,
    email: `test_b_${suffix}@example.com`,
    displayName: 'Test User B',
    password,
  });

  assert.equal(r.status, 201);
  userB = r.data.user;
  tokenB = r.data.accessToken;
  assert.ok(userB.id);
  assert.ok(tokenB);
});

await test('Reject duplicate registration', async () => {
  const r = await request('POST', '/auth/register', {
    username: userA.username,
    email: userA.email,
    displayName: 'Duplicate',
    password,
  });

  assert.equal(r.status, 409);
});

await test('Reject invalid password', async () => {
  const r = await request('POST', '/auth/login', {
    identifier: userA.username,
    password: 'incorrect-password',
  });

  assert.equal(r.status, 401);
});

await test('Login user A', async () => {
  const r = await request('POST', '/auth/login', {
    identifier: userA.username,
    password,
    deviceName: 'Integration Test',
  });

  assert.equal(r.status, 200);
  assert.equal(r.data.user.id, userA.id);
  tokenA = r.data.accessToken;
  refreshA = r.data.refreshToken;
});

await test('Reject unauthenticated request', async () => {
  const r = await request('GET', '/auth/me');
  assert.equal(r.status, 401);
});

await test('Get authenticated profile', async () => {
  const r = await request(
    'GET', '/auth/me', undefined, tokenA
  );

  assert.equal(r.status, 200);
  assert.equal(r.data.id, userA.id);
  assert.ok(!('passwordHash' in r.data));
});

await test('Update profile', async () => {
  const r = await request(
    'PATCH', '/users/me',
    {
      displayName: 'Updated Test User',
      bio: 'MikosChat integration test',
    },
    tokenA
  );

  assert.equal(r.status, 200);
  assert.equal(r.data.displayName, 'Updated Test User');
});

await test('Search for user B', async () => {
  const r = await request(
    'GET',
    `/users/search?q=${userB.username}`,
    undefined,
    tokenA
  );

  assert.equal(r.status, 200);
  assert.ok(r.data.some(u => u.id === userB.id));
});

await test('Public profile does not expose secrets', async () => {
  const r = await request(
    'GET', `/users/${userB.id}`, undefined, tokenA
  );

  assert.equal(r.status, 200);
  assert.ok(!('passwordHash' in r.data));
  assert.ok(!('email' in r.data));
});

await test('Send friend request', async () => {
  const r = await request(
    'POST', '/friends/request',
    { userId: userB.id },
    tokenA
  );

  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'PENDING');
  friendshipId = r.data.id;
});

await test('Reject duplicate friend request', async () => {
  const r = await request(
    'POST', '/friends/request',
    { userId: userB.id },
    tokenA
  );

  assert.equal(r.status, 409);
});

await test('Reject self friendship', async () => {
  const r = await request(
    'POST', '/friends/request',
    { userId: userA.id },
    tokenA
  );

  assert.equal(r.status, 400);
});

await test('Get incoming friend requests', async () => {
  const r = await request(
    'GET', '/friends/requests', undefined, tokenB
  );

  assert.equal(r.status, 200);
  assert.ok(
    r.data.incoming.some(f => f.id === friendshipId)
  );
});

await test('Sender cannot accept own request', async () => {
  const r = await request(
    'POST',
    `/friends/${friendshipId}/accept`,
    undefined,
    tokenA
  );

  assert.equal(r.status, 404);
});

await test('Accept friend request', async () => {
  const r = await request(
    'POST',
    `/friends/${friendshipId}/accept`,
    undefined,
    tokenB
  );

  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'ACCEPTED');
});

await test('Get friends list', async () => {
  const r = await request(
    'GET', '/friends', undefined, tokenA
  );

  assert.equal(r.status, 200);
  assert.ok(r.data.some(f => f.user.id === userB.id));
});

await test('Block user B', async () => {
  const r = await request(
    'POST', `/blocks/${userB.id}`,
    undefined, tokenA
  );

  assert.equal(r.status, 200);
  assert.equal(r.data.success, true);
});

await test('Blocked user removed from friends', async () => {
  const r = await request(
    'GET', '/friends', undefined, tokenA
  );

  assert.equal(r.status, 200);
  assert.ok(!r.data.some(f => f.user.id === userB.id));
});

await test('Blocked user cannot access profile', async () => {
  const r = await request(
    'GET', `/users/${userA.id}`,
    undefined, tokenB
  );

  assert.equal(r.status, 404);
});

await test('Blocked user cannot send request', async () => {
  const r = await request(
    'POST', '/friends/request',
    { userId: userA.id },
    tokenB
  );

  assert.equal(r.status, 404);
});

await test('Get blocked users', async () => {
  const r = await request(
    'GET', '/blocks', undefined, tokenA
  );

  assert.equal(r.status, 200);
  assert.ok(r.data.some(b => b.blocked.id === userB.id));
});

await test('Unblock user B', async () => {
  const r = await request(
    'DELETE', `/blocks/${userB.id}`,
    undefined, tokenA
  );

  assert.equal(r.status, 200);
});

await test('Access profile after unblock', async () => {
  const r = await request(
    'GET', `/users/${userA.id}`,
    undefined, tokenB
  );

  assert.equal(r.status, 200);
});

await test('Refresh token rotation', async () => {
  const oldRefresh = refreshA;

  const r = await request(
    'POST', '/auth/refresh',
    { refreshToken: refreshA }
  );

  assert.equal(r.status, 200);
  assert.notEqual(r.data.refreshToken, oldRefresh);

  tokenA = r.data.accessToken;
  refreshA = r.data.refreshToken;

  const old = await request(
    'POST', '/auth/refresh',
    { refreshToken: oldRefresh }
  );

  assert.equal(old.status, 401);
});

await test('Logout user A', async () => {
  const r = await request(
    'POST', '/auth/logout', undefined, tokenA
  );

  assert.equal(r.status, 200);
});

await test('Reject revoked access token', async () => {
  const r = await request(
    'GET', '/auth/me', undefined, tokenA
  );

  assert.equal(r.status, 401);
});

await test('Reject revoked refresh token', async () => {
  const r = await request(
    'POST', '/auth/refresh',
    { refreshToken: refreshA }
  );

  assert.equal(r.status, 401);
});

console.log('');
console.log('========================================');
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
console.log(`TOTAL:  ${passed + failed}`);
console.log('========================================');
console.log('');

process.exitCode = failed > 0 ? 1 : 0;
