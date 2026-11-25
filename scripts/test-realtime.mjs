import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { io } from 'socket.io-client';

const HOST = 'http://127.0.0.1:3000';
const BASE = HOST + '/api/v1';
const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');

let passed = 0;
let failed = 0;
let a, b, c, conversation;
let socketA, socketB, socketC, socketB2;
let sentMessage;

const sockets = [];

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
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json();

  assert.equal(
    res.status,
    expected,
    `${method} ${path}: HTTP ${res.status}, expected ${expected}`
  );

  return data;
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.error(`\x1b[31m[FAIL]\x1b[0m ${name}`);
    console.error(e.message);
    if (e.cause) console.error(e.cause);
    throw e;
  }
}

async function register(name) {
  return api('POST', '/auth/register', {
    username: `ws_${name}_${suffix}`,
    email: `ws_${name}_${suffix}@example.com`,
    displayName: `WebSocket Test ${name}`,
    password,
  }, undefined, 201);
}

function waitEvent(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const handler = data => {
      clearTimeout(timer);
      resolve(data);
    };

    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeout);

    socket.once(event, handler);
  });
}

async function connect(token) {
  const socket = io(HOST + '/chat', {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    timeout: 5000,
  });

  sockets.push(socket);

  const ready = waitEvent(socket, 'session:ready');

  socket.connect();

  const session = await ready;
  assert.ok(session.userId);

  return socket;
}

function emitAck(socket, event, payload) {
  return socket.timeout(5000).emitWithAck(
    event,
    payload
  );
}

console.log('\n=== MIKOSCHAT REALTIME TESTS ===\n');

try {

await test('Register test users', async () => {
  a = await register('a');
  b = await register('b');
  c = await register('c');
});

await test('Prepare direct conversation', async () => {
  const request = await api(
    'POST',
    '/friends/request',
    { userId: b.user.id },
    a.accessToken,
    201
  );

  await api(
    'POST',
    `/friends/${request.id}/accept`,
    undefined,
    b.accessToken
  );

  conversation = await api(
    'POST',
    '/conversations/direct',
    { userId: b.user.id },
    a.accessToken,
    201
  );
});

await test('Reject invalid JWT', async () => {
  const socket = io(HOST + '/chat', {
    auth: { token: 'invalid-token' },
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
  });

  sockets.push(socket);

  const error = waitEvent(socket, 'connect_error');

  socket.connect();

  const result = await error;

  assert.equal(result.message, 'Unauthorized');
  socket.disconnect();
});

await test('Connect user A', async () => {
  socketA = await connect(a.accessToken);
  assert.ok(socketA.connected);
});

await test('Connect user B', async () => {
  socketB = await connect(b.accessToken);
  assert.ok(socketB.connected);
});

await test('Connect outsider C', async () => {
  socketC = await connect(c.accessToken);
  assert.ok(socketC.connected);
});

await test('Connect second device of B', async () => {
  socketB2 = await connect(b.accessToken);
  assert.ok(socketB2.connected);
  assert.notEqual(socketB.id, socketB2.id);
});

await test('Send and receive realtime message', async () => {
  const incoming = waitEvent(socketB, 'message:new');
  const start = performance.now();

  const ack = await emitAck(socketA, 'message:send', {
    conversationId: conversation.id,
    clientMessageId: randomUUID(),
    content: 'First live MikosChat message!',
  });

  const received = await incoming;

  assert.equal(ack.success, true);
  assert.equal(received.id, ack.message.id);
  assert.equal(
    received.content,
    'First live MikosChat message!'
  );

  sentMessage = received;

  console.log(
    `       ACK + delivery: ${(performance.now() - start).toFixed(2)} ms`
  );
});

await test('Deliver to multiple devices', async () => {
  const incoming1 = waitEvent(socketB, 'message:new');
  const incoming2 = waitEvent(socketB2, 'message:new');

  const ack = await emitAck(socketA, 'message:send', {
    conversationId: conversation.id,
    clientMessageId: randomUUID(),
    content: 'Multi-device message',
  });

  const [first, second] = await Promise.all([
    incoming1,
    incoming2,
  ]);

  assert.equal(first.id, second.id);
  assert.equal(first.id, ack.message.id);
});

await test('Message persisted in PostgreSQL', async () => {
  const history = await api(
    'GET',
    `/conversations/${conversation.id}/messages`,
    undefined,
    b.accessToken
  );

  assert.ok(
    history.items.some(m => m.id === sentMessage.id)
  );
});

await test('Typing indicator start', async () => {
  const incoming = waitEvent(socketB, 'typing:update');

  await emitAck(socketA, 'typing:start', {
    conversationId: conversation.id,
  });

  const event = await incoming;

  assert.equal(event.isTyping, true);
  assert.equal(event.userId, a.user.id);
});

await test('Typing indicator stop', async () => {
  const incoming = waitEvent(socketB, 'typing:update');

  await emitAck(socketA, 'typing:stop', {
    conversationId: conversation.id,
  });

  const event = await incoming;

  assert.equal(event.isTyping, false);
});

await test('Reject outsider sending message', async () => {
  const error = waitEvent(socketC, 'exception');

  socketC.emit('message:send', {
    conversationId: conversation.id,
    clientMessageId: randomUUID(),
    content: 'Unauthorized message',
  });

  const result = await error;
  assert.ok(result.message);
});

await test('Reject invalid event payload', async () => {
  const error = waitEvent(socketA, 'exception');

  socketA.emit('message:send', {
    conversationId: 'invalid-uuid',
    content: '',
  });

  const result = await error;
  assert.ok(result.message);
});

await test('Outsider receives no private messages', async () => {
  let leaked = false;

  const listener = () => {
    leaked = true;
  };

  socketC.on('message:new', listener);

  try {
    const ack = await emitAck(socketA, 'message:send', {
      conversationId: conversation.id,
      clientMessageId: randomUUID(),
      content: 'Private message',
    });

    assert.equal(ack.success, true);

    await new Promise(resolve => setTimeout(resolve, 1000));

    assert.equal(leaked, false);
  } finally {
    socketC.off('message:new', listener);
  }
});

await test('Reject blocked user sending message', async () => {
  await api(
    'POST',
    `/blocks/${b.user.id}`,
    undefined,
    a.accessToken
  );

  const error = waitEvent(socketB, 'exception');

  socketB.emit('message:send', {
    conversationId: conversation.id,
    clientMessageId: randomUUID(),
    content: 'Blocked message',
  });

  const result = await error;
  assert.ok(result.message);
});

await test('Resume messaging after unblock', async () => {
  await api(
    'DELETE',
    `/blocks/${b.user.id}`,
    undefined,
    a.accessToken
  );

  const incoming = waitEvent(socketB, 'message:new');

  const ack = await emitAck(socketA, 'message:send', {
    conversationId: conversation.id,
    clientMessageId: randomUUID(),
    content: 'Unblocked successfully',
  });

  const result = await incoming;
  assert.equal(result.id, ack.message.id);
});

await test('Reject revoked WebSocket session', async () => {
  await api(
    'POST',
    '/auth/logout',
    undefined,
    a.accessToken
  );

  const disconnected = waitEvent(socketA, 'disconnect');

  socketA.emit('message:send', {
    conversationId: conversation.id,
    clientMessageId: randomUUID(),
    content: 'Revoked session message',
  });

  await disconnected;

  assert.equal(socketA.connected, false);
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
  console.log(`TOTAL EXECUTED: ${passed + failed}`);
  console.log('========================================\n');

  process.exitCode = failed > 0 ? 1 : 0;
}
