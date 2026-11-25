import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { io } from 'socket.io-client';

const HOST = 'http://127.0.0.1:3000';
const BASE = HOST + '/api/v1';
const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');

const sockets = [];
let passed = 0;
let failed = 0;
let a, b, c;
let socketA, socketB, socketB2;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function api(method, path, body, token, expected = 200) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined
      ? undefined
      : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  const data = await res.json();

  assert.equal(res.status, expected,
    `${method} ${path}: HTTP ${res.status}, expected ${expected}`);

  return data;
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    failed++;
    console.error(`[FAIL] ${name}`);
    console.error(error.message);
    throw error;
  }
}

async function register(name) {
  return api('POST', '/auth/register', {
    username: `pr_${name}_${suffix}`,
    email: `pr_${name}_${suffix}@example.com`,
    displayName: `Presence Test ${name}`,
    password,
  }, undefined, 201);
}

async function connect(token) {
  const socket = io(HOST + '/chat', {
    auth: { token },
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
  });

  sockets.push(socket);

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 5000);

    socket.once('session:ready', data => {
      clearTimeout(timer);
      resolve(data);
    });

    socket.once('connect_error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  socket.connect();
  await ready;

  return socket;
}

async function statuses(token) {
  return api('GET', '/presence/friends',
    undefined, token);
}

async function waitStatus(token, userId, online) {
  for (let i = 0; i < 20; i++) {
    const result = await statuses(token);
    const user = result.find(u => u.userId === userId);

    if (user && user.online === online) {
      return user;
    }

    await sleep(250);
  }

  throw new Error(`Expected online=${online}`);
}

console.log('\n=== MIKOSCHAT PRESENCE TESTS ===\n');

try {

await test('Register three users', async () => {
  a = await register('a');
  b = await register('b');
  c = await register('c');
});

await test('Establish friendship A and B', async () => {
  const request = await api(
    'POST', '/friends/request',
    { userId: b.user.id },
    a.accessToken, 201
  );

  await api(
    'POST', `/friends/${request.id}/accept`,
    undefined, b.accessToken
  );
});

await test('Reject unauthenticated presence request', async () => {
  await api(
    'GET', '/presence/friends',
    undefined, undefined, 401
  );
});

await test('Disconnected friend is offline', async () => {
  await waitStatus(a.accessToken, b.user.id, false);
});

await test('Connect observer A', async () => {
  socketA = await connect(a.accessToken);
});

const presenceEvents = [];

socketA.on('presence:update', event => {
  presenceEvents.push(event);
});

await test('Friend becomes online', async () => {
  socketB = await connect(b.accessToken);
  await waitStatus(a.accessToken, b.user.id, true);
});

await test('Receive online notification', async () => {
  for (let i = 0; i < 20; i++) {
    if (presenceEvents.some(e =>
      e.userId === b.user.id && e.online === true
    )) return;

    await sleep(250);
  }

  throw new Error('Online notification not received');
});

await test('Connect second device', async () => {
  socketB2 = await connect(b.accessToken);
  await sleep(500);

  await waitStatus(a.accessToken, b.user.id, true);
});

await test('Disconnect first device', async () => {
  socketB.disconnect();
  await sleep(500);

  await waitStatus(a.accessToken, b.user.id, true);
});

await test('Disconnect last device', async () => {
  socketB2.disconnect();

  const result = await waitStatus(
    a.accessToken, b.user.id, false
  );

  assert.ok(result.lastSeenAt);
});

await test('Receive offline notification', async () => {
  for (let i = 0; i < 20; i++) {
    if (presenceEvents.some(e =>
      e.userId === b.user.id && e.online === false
    )) return;

    await sleep(250);
  }

  throw new Error('Offline notification not received');
});

await test('Outsider cannot see presence', async () => {
  const result = await statuses(c.accessToken);

  assert.equal(
    result.some(u => u.userId === b.user.id),
    false
  );
});

await test('Reconnect friend', async () => {
  socketB = await connect(b.accessToken);

  await waitStatus(a.accessToken, b.user.id, true);
});

await test('Block hides presence', async () => {
  await api(
    'POST', `/blocks/${b.user.id}`,
    undefined, a.accessToken
  );

  const resultA = await statuses(a.accessToken);
  const resultB = await statuses(b.accessToken);

  assert.equal(
    resultA.some(u => u.userId === b.user.id),
    false
  );

  assert.equal(
    resultB.some(u => u.userId === a.user.id),
    false
  );
});

} catch {
  console.error('Test suite stopped after failure.');
} finally {
  for (const socket of sockets) {
    socket.disconnect();
  }

  console.log('\n========================================');
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log(`TOTAL:  ${passed + failed}`);
  console.log('========================================\n');

  process.exitCode = failed > 0 ? 1 : 0;
}
