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
let conversation, message, secondMessage;
let deliveredAt, readAt;

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
    username: `receipt_${name}_${suffix}`,
    email: `receipt_${name}_${suffix}@example.com`,
    displayName: `Receipt Test ${name}`,
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

  socket.on('receipt:update', payload => {
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

async function waitReceipt(name, messageId, read = false) {
  for (let i = 0; i < 40; i++) {
    const receipt = events[name].find(e =>
      e.messageId === messageId &&
      e.deliveredAt &&
      (!read || e.readAt)
    );

    if (receipt) return receipt;

    await sleep(100);
  }

  throw new Error(`Missing receipt event for ${name}`);
}

async function sendMessage(content) {
  return api(
    'POST',
    `/conversations/${conversation.id}/messages`,
    {
      clientMessageId: randomUUID(),
      content,
    },
    a.accessToken,
    201,
  );
}

console.log('\n=== MIKOSCHAT RECEIPT TESTS ===\n');

try {
  await test('Register three users', async () => {
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
      201,
    );

    await api(
      'POST',
      `/friends/${request.id}/accept`,
      undefined,
      b.accessToken,
    );

    conversation = await api(
      'POST',
      '/conversations/direct',
      { userId: b.user.id },
      a.accessToken,
      201,
    );
  });

  await test('Connect WebSocket clients', async () => {
    socketA = await connect(a.accessToken, 'a');
    socketB = await connect(b.accessToken, 'b');
    socketC = await connect(c.accessToken, 'c');
  });

  await test('New message has pending receipt', async () => {
    message = await sendMessage('Receipt test');

    const receipt = message.receipts.find(
      r => r.userId === b.user.id
    );

    assert.ok(receipt);
    assert.equal(receipt.deliveredAt, null);
    assert.equal(receipt.readAt, null);
  });

  await test('Unauthenticated receipt rejected', async () => {
    await api(
      'POST',
      `/messages/${message.id}/delivered`,
      undefined,
      undefined,
      401,
    );
  });

  await test('Recipient confirms delivery via REST', async () => {
    const receipt = await api(
      'POST',
      `/messages/${message.id}/delivered`,
      undefined,
      b.accessToken,
    );

    assert.ok(receipt.deliveredAt);
    assert.equal(receipt.readAt, null);
    assert.equal(receipt.userId, b.user.id);

    deliveredAt = receipt.deliveredAt;
  });

  await test('Sender receives delivery event', async () => {
    const receipt = await waitReceipt('a', message.id);

    assert.equal(receipt.deliveredAt, deliveredAt);
    assert.equal(receipt.senderId, a.user.id);
    assert.equal(receipt.conversationId, conversation.id);
  });

  await test('Repeated delivery is idempotent', async () => {
    const before = events.a.length;

    const receipt = await api(
      'POST',
      `/messages/${message.id}/delivered`,
      undefined,
      b.accessToken,
    );

    assert.equal(receipt.deliveredAt, deliveredAt);

    await sleep(500);

    assert.equal(events.a.length, before);
  });

  await test('Sender cannot confirm own receipt', async () => {
    await api(
      'POST',
      `/messages/${message.id}/delivered`,
      undefined,
      a.accessToken,
      404,
    );
  });

  await test('Outsider cannot confirm receipt', async () => {
    await api(
      'POST',
      `/messages/${message.id}/read`,
      undefined,
      c.accessToken,
      404,
    );
  });

  await test('Recipient confirms read via WebSocket', async () => {
    const ack = await socketB.timeout(5000).emitWithAck(
      'message:read',
      { messageId: message.id },
    );

    assert.equal(ack.success, true);
    assert.equal(ack.receipt.deliveredAt, deliveredAt);
    assert.ok(ack.receipt.readAt);

    readAt = ack.receipt.readAt;

    const event = await waitReceipt('a', message.id, true);

    assert.equal(event.readAt, readAt);
  });

  await test('Repeated read preserves timestamps', async () => {
    const before = events.a.length;

    const receipt = await api(
      'POST',
      `/messages/${message.id}/read`,
      undefined,
      b.accessToken,
    );

    assert.equal(receipt.deliveredAt, deliveredAt);
    assert.equal(receipt.readAt, readAt);

    await sleep(500);

    assert.equal(events.a.length, before);
  });

  await test('Read automatically confirms delivery', async () => {
    secondMessage = await sendMessage('Direct read test');

    const receipt = await api(
      'POST',
      `/messages/${secondMessage.id}/read`,
      undefined,
      b.accessToken,
    );

    assert.ok(receipt.deliveredAt);
    assert.ok(receipt.readAt);

    assert.ok(
      Date.parse(receipt.deliveredAt) <=
      Date.parse(receipt.readAt)
    );
  });

  await test('Message history contains persisted receipts', async () => {
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

    const receipt = stored.receipts.find(
      r => r.userId === b.user.id
    );

    assert.ok(receipt);
    assert.equal(receipt.deliveredAt, deliveredAt);
    assert.equal(receipt.readAt, readAt);
  });

  await test('Outsider receives no receipt events', async () => {
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
