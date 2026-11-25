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
let conversation, message;

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
    username: `reaction_${name}_${suffix}`,
    email: `reaction_${name}_${suffix}@example.com`,
    displayName: `Reaction Test ${name}`,
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

  socket.on('reaction:update', payload => {
    events[name].push(payload);
  });

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

async function waitEvent(name, predicate) {
  for (let i = 0; i < 40; i++) {
    const event = events[name].find(predicate);

    if (event) return event;

    await sleep(100);
  }

  throw new Error(`Missing reaction event for ${name}`);
}

function reactionPath() {
  return `/messages/${message.id}/reaction`;
}

console.log('\n=== MIKOSCHAT REACTION TESTS ===\n');

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

  await test('Connect WebSocket clients', async () => {
    await connect(a.accessToken, 'a');
    await connect(b.accessToken, 'b');
    await connect(c.accessToken, 'c');
  });

  await test('Create message without reactions', async () => {
    message = await api(
      'POST',
      `/conversations/${conversation.id}/messages`,
      {
        clientMessageId: randomUUID(),
        content: 'MikosChat reaction test',
      },
      a.accessToken, 201,
    );

    assert.equal(message.reactions.length, 0);
  });

  await test('Unauthenticated reaction rejected', async () => {
    await api(
      'PUT', reactionPath(),
      { emoji: '❤️' },
      undefined, 401,
    );
  });

  await test('Recipient adds reaction', async () => {
    const result = await api(
      'PUT', reactionPath(),
      { emoji: '❤️' },
      b.accessToken,
    );

    assert.equal(result.reactions.length, 1);
    assert.equal(result.reactions[0].emoji, '❤️');
    assert.equal(result.reactions[0].userId, b.user.id);
  });

  await test('Reaction broadcasts to both users', async () => {
    for (const name of ['a', 'b']) {
      const event = await waitEvent(name, e =>
        e.messageId === message.id &&
        e.reactions.some(r =>
          r.userId === b.user.id && r.emoji === '❤️'
        )
      );

      assert.equal(event.conversationId, conversation.id);
    }
  });

  await test('Repeated reaction is idempotent', async () => {
    const before = events.a.length;

    const result = await api(
      'PUT', reactionPath(),
      { emoji: '❤️' },
      b.accessToken,
    );

    assert.equal(result.reactions.length, 1);

    await sleep(500);

    assert.equal(events.a.length, before);
  });

  await test('Changing emoji replaces previous reaction', async () => {
    const result = await api(
      'PUT', reactionPath(),
      { emoji: '🔥' },
      b.accessToken,
    );

    assert.equal(result.reactions.length, 1);
    assert.equal(result.reactions[0].emoji, '🔥');

    await waitEvent('a', e =>
      e.messageId === message.id &&
      e.reactions.some(r =>
        r.userId === b.user.id && r.emoji === '🔥'
      )
    );
  });

  await test('Sender can react to own message', async () => {
    const result = await api(
      'PUT', reactionPath(),
      { emoji: '😂' },
      a.accessToken,
    );

    assert.equal(result.reactions.length, 2);

    assert.ok(result.reactions.some(r =>
      r.userId === a.user.id && r.emoji === '😂'
    ));
  });

  await test('Invalid emoji rejected', async () => {
    await api(
      'PUT', reactionPath(),
      { emoji: 'invalid' },
      b.accessToken, 400,
    );
  });

  await test('Outsider cannot add reaction', async () => {
    await api(
      'PUT', reactionPath(),
      { emoji: '👍' },
      c.accessToken, 404,
    );
  });

  await test('Recipient removes only own reaction', async () => {
    const result = await api(
      'DELETE', reactionPath(),
      undefined,
      b.accessToken,
    );

    assert.equal(result.reactions.length, 1);
    assert.equal(result.reactions[0].userId, a.user.id);

    await waitEvent('a', e =>
      e.messageId === message.id &&
      e.userId === b.user.id &&
      e.reactions.length === 1 &&
      e.reactions[0].userId === a.user.id
    );
  });

  await test('Repeated removal emits no duplicate event', async () => {
    const before = events.a.length;

    await api(
      'DELETE', reactionPath(),
      undefined,
      b.accessToken,
    );

    await sleep(500);

    assert.equal(events.a.length, before);
  });

  await test('History contains persisted reactions', async () => {
    const history = await api(
      'GET',
      `/conversations/${conversation.id}/messages`,
      undefined,
      a.accessToken,
    );

    const stored = history.items.find(
      m => m.id === message.id
    );

    assert.ok(stored);
    assert.equal(stored.reactions.length, 1);
    assert.equal(stored.reactions[0].emoji, '😂');
  });

  await test('Blocked user cannot add reaction', async () => {
    await api(
      'POST', `/blocks/${b.user.id}`,
      undefined, a.accessToken,
    );

    await api(
      'PUT', reactionPath(),
      { emoji: '👍' },
      b.accessToken, 403,
    );

    await api(
      'DELETE', `/blocks/${b.user.id}`,
      undefined, a.accessToken,
    );
  });

  await test('Deleted message cannot receive reactions', async () => {
    await api(
      'DELETE', `/messages/${message.id}`,
      undefined, a.accessToken,
    );

    await api(
      'PUT', reactionPath(),
      { emoji: '👍' },
      b.accessToken, 404,
    );

    const history = await api(
      'GET',
      `/conversations/${conversation.id}/messages`,
      undefined, a.accessToken,
    );

    const stored = history.items.find(
      m => m.id === message.id
    );

    assert.ok(stored.deletedAt);
    assert.equal(stored.reactions.length, 0);
  });

  await test('Outsider receives no reaction events', async () => {
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
