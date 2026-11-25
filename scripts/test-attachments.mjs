import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { io } from 'socket.io-client';
import sharp from 'sharp';

const HOST = 'http://127.0.0.1:3000';
const BASE = HOST + '/api/v1';

const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');

let passed = 0;
let failed = 0;

let alice;
let bob;
let outsider;
let conversationId;
let message;
let attachment;
let socket;
let realtimeEvent;

const clientMessageId = randomUUID();

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

async function api(method, path, body, token) {
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  return fetch(BASE + path, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(30000),
  });
}

async function register(name) {
  const username = `${name}_${suffix}`;

  const res = await api('POST', '/auth/register', {
    username,
    email: `${username}@example.com`,
    displayName: name,
    password,
  });

  assert.equal(res.status, 201);
  return res.json();
}

async function upload({
  token = alice.accessToken,
  id = clientMessageId,
  files = [],
  content = 'Multimedia test',
} = {}) {
  const form = new FormData();

  form.append('clientMessageId', id);
  form.append('content', content);

  for (const file of files) {
    form.append(
      'files',
      new Blob([file.buffer], {
        type: file.mime,
      }),
      file.name,
    );
  }

  return api(
    'POST',
    `/conversations/${conversationId}/attachments`,
    form,
    token,
  );
}

async function download(id, token) {
  return api(
    'GET',
    `/attachments/${id}/download`,
    undefined,
    token,
  );
}

const png = await sharp({
  create: {
    width: 800,
    height: 600,
    channels: 3,
    background: '#7367f0',
  },
}).png().toBuffer();

const image = {
  buffer: png,
  mime: 'image/png',
  name: 'test-image.png',
};

console.log('\n=== MIKOSCHAT ATTACHMENT TESTS ===\n');

try {
  await test('Register three test users', async () => {
    alice = await register('alice');
    bob = await register('bob');
    outsider = await register('outsider');
  });

  await test('Create friendship', async () => {
    const res = await api(
      'POST',
      '/friends/request',
      { userId: bob.user.id },
      alice.accessToken,
    );

    assert.equal(res.status, 201);

    const friendship = await res.json();

    const accepted = await api(
      'POST',
      `/friends/${friendship.id}/accept`,
      undefined,
      bob.accessToken,
    );

    assert.equal(accepted.status, 200);
  });

  await test('Create direct conversation', async () => {
    const res = await api(
      'POST',
      '/conversations/direct',
      { userId: bob.user.id },
      alice.accessToken,
    );

    assert.equal(res.status, 201);

    const data = await res.json();
    conversationId = data.id;

    assert.ok(conversationId);
  });

  await test('Connect recipient to Socket.IO', async () => {
    socket = io(HOST + '/chat', {
      auth: {
        token: bob.accessToken,
      },
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Socket timeout')),
        10000,
      );

      socket.once('session:ready', () => {
        clearTimeout(timer);
        resolve();
      });

      socket.once('connect_error', error => {
        clearTimeout(timer);
        reject(error);
      });

      socket.connect();
    });

    socket.on('message:new', data => {
      realtimeEvent = data;
    });
  });

  await test('Unauthenticated upload rejected', async () => {
    const res = await upload({
      token: null,
      files: [image],
    });

    assert.equal(res.status, 401);
  });

  await test('Outsider upload rejected', async () => {
    const res = await upload({
      token: outsider.accessToken,
      files: [image],
    });

    assert.equal(res.status, 404);
  });

  await test('Upload valid image', async () => {
    const res = await upload({
      files: [image],
    });

    assert.equal(res.status, 201);

    message = await res.json();

    assert.equal(message.type, 'IMAGE');
    assert.equal(message.content, 'Multimedia test');
    assert.equal(message.attachments.length, 1);

    attachment = message.attachments[0];
  });

  await test('Attachment metadata correct', async () => {
    assert.equal(attachment.mimeType, 'image/png');
    assert.equal(attachment.originalName, 'test-image.png');
    assert.equal(attachment.size, png.length);
    assert.equal(attachment.width, 800);
    assert.equal(attachment.height, 600);
    assert.ok(attachment.downloadUrl);
    assert.equal(attachment.storageKey, undefined);
  });

  await test('Recipient receives realtime message', async () => {
    for (let i = 0; i < 50 && !realtimeEvent; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.ok(realtimeEvent);
    assert.equal(realtimeEvent.id, message.id);
    assert.equal(
      realtimeEvent.attachments[0].id,
      attachment.id,
    );
  });

  await test('Message persisted in history', async () => {
    const res = await api(
      'GET',
      `/conversations/${conversationId}/messages`,
      undefined,
      bob.accessToken,
    );

    assert.equal(res.status, 200);

    const data = await res.json();

    const saved = data.items.find(
      item => item.id === message.id,
    );

    assert.ok(saved);
    assert.equal(saved.attachments[0].id, attachment.id);
  });

  await test('Sender can download attachment', async () => {
    const res = await download(
      attachment.id,
      alice.accessToken,
    );

    assert.equal(res.status, 200);

    const buffer = Buffer.from(await res.arrayBuffer());

    assert.deepEqual(buffer, png);
  });

  await test('Recipient can download attachment', async () => {
    const res = await download(
      attachment.id,
      bob.accessToken,
    );

    assert.equal(res.status, 200);

    assert.deepEqual(
      Buffer.from(await res.arrayBuffer()),
      png,
    );
  });

  await test('Unauthenticated download rejected', async () => {
    const res = await download(attachment.id);
    assert.equal(res.status, 401);
  });

  await test('Outsider download rejected', async () => {
    const res = await download(
      attachment.id,
      outsider.accessToken,
    );

    assert.equal(res.status, 404);
  });

  await test('Duplicate upload is idempotent', async () => {
    const res = await upload({
      files: [image],
    });

    assert.equal(res.status, 201);

    const duplicate = await res.json();

    assert.equal(duplicate.id, message.id);
    assert.equal(
      duplicate.attachments[0].id,
      attachment.id,
    );
  });

  await test('Invalid file rejected', async () => {
    const res = await upload({
      id: randomUUID(),
      files: [{
        buffer: Buffer.from('Invalid PNG'),
        mime: 'image/png',
        name: 'fake.png',
      }],
    });

    assert.equal(res.status, 400);
  });

  await test('Empty upload rejected', async () => {
    const res = await upload({
      id: randomUUID(),
      files: [],
    });

    assert.equal(res.status, 400);
  });

  await test('Invalid clientMessageId rejected', async () => {
    const res = await upload({
      id: 'invalid-uuid',
      files: [image],
    });

    assert.equal(res.status, 400);
  });

  console.log('[WAIT] Upload rate limit cooldown...');
  await new Promise(resolve => setTimeout(resolve, 65000));

  await test('Multiple attachments supported', async () => {
    const res = await upload({
      id: randomUUID(),
      files: [
        image,
        {
          buffer: Buffer.from('MikosChat attachment test'),
          mime: 'text/plain',
          name: 'test.txt',
        },
      ],
    });

    assert.equal(res.status, 201);

    const data = await res.json();

    assert.equal(data.type, 'FILE');
    assert.equal(data.attachments.length, 2);
  });

  await test('Oversized file rejected', async () => {
    const res = await upload({
      id: randomUUID(),
      files: [{
        buffer: Buffer.alloc(51 * 1024 * 1024),
        mime: 'image/png',
        name: 'oversized.png',
      }],
    });

    assert.equal(res.status, 413);
  });

  await test('Recipient cannot delete sender message', async () => {
    const res = await api(
      'DELETE',
      `/messages/${message.id}`,
      undefined,
      bob.accessToken,
    );

    assert.equal(res.status, 404);
  });

  await test('Sender can delete multimedia message', async () => {
    const res = await api(
      'DELETE',
      `/messages/${message.id}`,
      undefined,
      alice.accessToken,
    );

    assert.equal(res.status, 200);
  });

  await test('Deleted attachment cannot be downloaded', async () => {
    const res = await download(
      attachment.id,
      bob.accessToken,
    );

    assert.equal(res.status, 404);
  });

  await test('Deleted message hides attachments in history', async () => {
    const res = await api(
      'GET',
      `/conversations/${conversationId}/messages`,
      undefined,
      bob.accessToken,
    );

    assert.equal(res.status, 200);

    const data = await res.json();

    const deleted = data.items.find(
      item => item.id === message.id,
    );

    assert.ok(deleted.deletedAt);
    assert.equal(deleted.attachments.length, 0);
  });

} catch {
  console.log('\nTest suite stopped after failure.');
} finally {
  socket?.disconnect();

  for (const user of [alice, bob, outsider]) {
    if (user?.accessToken) {
      await api(
        'POST',
        '/auth/logout',
        undefined,
        user.accessToken,
      ).catch(() => {});
    }
  }
}

console.log('\n========================================');
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
console.log(`TOTAL:  ${passed + failed}`);
console.log('========================================\n');

process.exitCode = failed > 0 ? 1 : 0;
