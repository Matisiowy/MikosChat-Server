import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const HOST = 'http://127.0.0.1:3000';
const BASE = HOST + '/api/v1';
const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');

const sockets = [];
const events = { a: [], b: [], c: [] };

let passed = 0;
let failed = 0;
let a, b, c;
let socketA, socketB, socketC;
let conversation, message;
let clientMessageId = randomUUID();

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function api(method, path, body, token, expected = 200) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined
      ? undefined
      : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  const data = await response.json();

  assert.equal(
    response.status,
    expected,
    `${method} ${path}: HTTP ${response.status}, expected ${expected}`,
  );

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
    username: `sync_${name}_${suffix}`,
    email: `sync_${name}_${suffix}@example.com`,
    displayName: `Sync Test ${name}`,
    password,
  }, undefined, 201);
}

async function connect(token, name) {
  const socket = io(HOST + '/chat', {
    auth: { token },
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
  });

  sockets.push(socket);

  for (const event of [
    'message:new',
    'message:updated',
    'message:deleted',
  ]) {
    socket.on(event, payload => {
      events[name].push({ event, payload });
    });
  }

  await new Promise((resolve, reject) => {
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

    socket.connect();
  });

  return socket;
}

async function waitEvent(name, event, id) {
  for (let i = 0; i < 40; i++) {
    const result = events[name].find(e =>
      e.event === event && e.payload.id === id
    );

    if (result) return result.payload;

    await sleep(100);
  }

  throw new Error(`Missing ${event} for ${name}`);
}

function countEvents(name, event, id) {
  return events[name].filter(e =>
    e.event === event && e.payload.id === id
  ).length;
}

console.log('\n=== MIKOSCHAT SYNC TESTS ===\n');

try {

  await test('Register three users', async () => {
    a = await register('a');
    b = await register('b');
    c = await register('c');
  });

  await test('Prepare direct conversation', async () => {
    const request = await api(
      'POST', '/friends/request',
      { userId: b.user.id },
      a.accessToken, 201,
    );

    await api(
      'POST', `/friends/${request.id}/accept`,
      undefined, b.accessToken,
    );

    conversation = await api(
      'POST', '/conversations/direct',
      { userId: b.user.id },
      a.accessToken, 201,
    );
  });

  await test('Connect all WebSocket clients', async () => {
    socketA = await connect(a.accessToken, 'a');
    socketB = await connect(b.accessToken, 'b');
    socketC = await connect(c.accessToken, 'c');
  });

  await test('REST send broadcasts to recipient', async () => {
    message = await api(
      'POST',
      `/conversations/${conversation.id}/messages`,
      {
        clientMessageId,
        content: 'REST synchronization test',
      },
      a.accessToken, 201,
    );

    const received = await waitEvent(
      'b', 'message:new', message.id,
    );

    assert.equal(received.content, message.content);
  });

  await test('REST send broadcasts to sender', async () => {
    await waitEvent('a', 'message:new', message.id);
  });

  await test('Duplicate REST send emits no new event', async () => {
    const duplicate = await api(
      'POST',
      `/conversations/${conversation.id}/messages`,
      {
        clientMessageId,
        content: 'REST synchronization test',
      },
      a.accessToken, 201,
    );

    assert.equal(duplicate.id, message.id);

    await sleep(500);

    assert.equal(
      countEvents('a', 'message:new', message.id), 1,
    );

    assert.equal(
      countEvents('b', 'message:new', message.id), 1,
    );
  });

  await test('Duplicate WebSocket send emits no event', async () => {
    const ack = await socketA.timeout(5000).emitWithAck(
      'message:send',
      {
        conversationId: conversation.id,
        clientMessageId,
        content: 'REST synchronization test',
      },
    );

    assert.equal(ack.success, true);
    assert.equal(ack.message.id, message.id);

    await sleep(500);

    assert.equal(
      countEvents('a', 'message:new', message.id), 1,
    );

    assert.equal(
      countEvents('b', 'message:new', message.id), 1,
    );
  });

  await test('REST edit broadcasts updated message', async () => {
    await api(
      'PATCH', `/messages/${message.id}`,
      { content: 'Edited synchronization test' },
      a.accessToken,
    );

    for (const name of ['a', 'b']) {
      const updated = await waitEvent(
        name, 'message:updated', message.id,
      );

      assert.equal(
        updated.content,
        'Edited synchronization test',
      );

      assert.ok(updated.editedAt);
    }
  });

  await test('Unauthorized edit emits no event', async () => {
    await api(
      'PATCH', `/messages/${message.id}`,
      { content: 'Unauthorized edit' },
      b.accessToken, 404,
    );

    await sleep(500);

    assert.equal(
      countEvents('a', 'message:updated', message.id), 1,
    );

    assert.equal(
      countEvents('b', 'message:updated', message.id), 1,
    );
  });

  await test('REST delete broadcasts deletion', async () => {
    await api(
      'DELETE', `/messages/${message.id}`,
      undefined, a.accessToken,
    );

    for (const name of ['a', 'b']) {
      const deleted = await waitEvent(
        name, 'message:deleted', message.id,
      );

      assert.equal(
        deleted.conversationId,
        conversation.id,
      );

      assert.ok(deleted.deletedAt);
    }
  });

  await test('Repeated delete emits no duplicate event', async () => {
    await api(
      'DELETE', `/messages/${message.id}`,
      undefined, a.accessToken,
    );

    await sleep(500);

    assert.equal(
      countEvents('a', 'message:deleted', message.id), 1,
    );

    assert.equal(
      countEvents('b', 'message:deleted', message.id), 1,
    );
  });

  await test('Outsider receives no private events', async () => {
    await sleep(500);

    assert.equal(events.c.length, 0);
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
