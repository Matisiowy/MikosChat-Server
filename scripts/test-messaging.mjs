import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';

const BASE = 'http://127.0.0.1:3000/api/v1';
const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');

let passed = 0;
let failed = 0;

let a, b, c, direct, group, message, reply;
const clientMessageId = randomUUID();

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
    console.log(`\x1b[31m[FAIL]\x1b[0m ${name}`);
    console.log(e.message);
    if (e.cause) console.error(e.cause);
  }
}

async function register(name) {
  return api('POST', '/auth/register', {
    username: `msg_${name}_${suffix}`,
    email: `msg_${name}_${suffix}@example.com`,
    displayName: `Messaging Test ${name}`,
    password,
  }, undefined, 201);
}

async function makeFriends(sender, receiver) {
  const request = await api(
    'POST',
    '/friends/request',
    { userId: receiver.user.id },
    sender.accessToken,
    201
  );

  return api(
    'POST',
    `/friends/${request.id}/accept`,
    undefined,
    receiver.accessToken
  );
}

console.log('\n=== MIKOSCHAT MESSAGING TESTS ===\n');

await test('API health', async () => {
  await api('GET', '/health');
});

await test('Register three users', async () => {
  a = await register('a');
  b = await register('b');
  c = await register('c');
});

await test('Reject direct chat with stranger', async () => {
  await api('POST', '/conversations/direct', {
    userId: b.user.id,
  }, a.accessToken, 403);
});

await test('Establish friendship A and B', async () => {
  await makeFriends(a, b);
});

await test('Create direct conversation', async () => {
  direct = await api('POST', '/conversations/direct', {
    userId: b.user.id,
  }, a.accessToken, 201);

  assert.equal(direct.type, 'DIRECT');
  assert.equal(direct.members.length, 2);
});

await test('Prevent duplicate conversations', async () => {
  const result = await api('POST', '/conversations/direct', {
    userId: a.user.id,
  }, b.accessToken, 201);

  assert.equal(result.id, direct.id);
});

await test('List conversations', async () => {
  const result = await api(
    'GET', '/conversations',
    undefined, a.accessToken
  );

  assert.ok(result.some(x => x.id === direct.id));
});

await test('Reject outsider access', async () => {
  await api(
    'GET', `/conversations/${direct.id}`,
    undefined, c.accessToken, 404
  );
});

await test('Send first message', async () => {
  message = await api(
    'POST',
    `/conversations/${direct.id}/messages`,
    {
      clientMessageId,
      content: 'Hello from MikosChat!',
    },
    a.accessToken,
    201
  );

  assert.equal(message.content, 'Hello from MikosChat!');
  assert.equal(message.senderId, a.user.id);
  assert.equal(message.receipts.length, 1);
});

await test('Prevent duplicate messages', async () => {
  const result = await api(
    'POST',
    `/conversations/${direct.id}/messages`,
    {
      clientMessageId,
      content: 'Hello from MikosChat!',
    },
    a.accessToken,
    201
  );

  assert.equal(result.id, message.id);
});

await test('Receive message history', async () => {
  const result = await api(
    'GET',
    `/conversations/${direct.id}/messages`,
    undefined,
    b.accessToken
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, message.id);
});

await test('Reply to message', async () => {
  reply = await api(
    'POST',
    `/conversations/${direct.id}/messages`,
    {
      clientMessageId: randomUUID(),
      content: 'MikosChat works!',
      replyToId: message.id,
    },
    b.accessToken,
    201
  );

  assert.equal(reply.replyToId, message.id);
});

await test('Paginate message history', async () => {
  const first = await api(
    'GET',
    `/conversations/${direct.id}/messages?limit=1`,
    undefined,
    a.accessToken
  );

  assert.equal(first.items.length, 1);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].id, reply.id);

  const second = await api(
    'GET',
    `/conversations/${direct.id}/messages?limit=1&cursor=${first.nextCursor}`,
    undefined,
    a.accessToken
  );

  assert.equal(second.items[0].id, message.id);
  assert.equal(second.hasMore, false);
});

await test('Reject outsider message history', async () => {
  await api(
    'GET',
    `/conversations/${direct.id}/messages`,
    undefined,
    c.accessToken,
    404
  );
});

await test('Reject outsider sending message', async () => {
  await api(
    'POST',
    `/conversations/${direct.id}/messages`,
    {
      clientMessageId: randomUUID(),
      content: 'Unauthorized message',
    },
    c.accessToken,
    404
  );
});

await test('Edit own message', async () => {
  const result = await api(
    'PATCH',
    `/messages/${message.id}`,
    { content: 'Edited message' },
    a.accessToken
  );

  assert.equal(result.content, 'Edited message');
  assert.ok(result.editedAt);
});

await test('Reject editing another user message', async () => {
  await api(
    'PATCH',
    `/messages/${message.id}`,
    { content: 'Unauthorized edit' },
    b.accessToken,
    404
  );
});

await test('Reject deleting another user message', async () => {
  await api(
    'DELETE',
    `/messages/${message.id}`,
    undefined,
    b.accessToken,
    404
  );
});

await test('Delete own message', async () => {
  await api(
    'DELETE',
    `/messages/${message.id}`,
    undefined,
    a.accessToken
  );

  const history = await api(
    'GET',
    `/conversations/${direct.id}/messages`,
    undefined,
    b.accessToken
  );

  const deleted = history.items.find(
    x => x.id === message.id
  );

  assert.equal(deleted.content, null);
  assert.ok(deleted.deletedAt);
});

await test('Establish friendship A and C', async () => {
  await makeFriends(a, c);
});

await test('Create group conversation', async () => {
  group = await api(
    'POST',
    '/conversations/group',
    {
      name: 'MikosChat Test Group',
      memberIds: [b.user.id, c.user.id],
    },
    a.accessToken,
    201
  );

  assert.equal(group.type, 'GROUP');
  assert.equal(group.members.length, 3);

  const owner = group.members.find(
    x => x.userId === a.user.id
  );

  assert.equal(owner.role, 'OWNER');
});

await test('Send group message', async () => {
  const result = await api(
    'POST',
    `/conversations/${group.id}/messages`,
    {
      clientMessageId: randomUUID(),
      content: 'Hello everyone!',
    },
    a.accessToken,
    201
  );

  assert.equal(result.receipts.length, 2);
});

await test('Group member receives message', async () => {
  const result = await api(
    'GET',
    `/conversations/${group.id}/messages`,
    undefined,
    c.accessToken
  );

  assert.equal(result.items[0].content, 'Hello everyone!');
});

await test('Reject cross-conversation message ID reuse', async () => {
  await api(
    'POST',
    `/conversations/${group.id}/messages`,
    {
      clientMessageId,
      content: 'Duplicate ID',
    },
    a.accessToken,
    409
  );
});

await test('Block conversation participant', async () => {
  await api(
    'POST',
    `/blocks/${b.user.id}`,
    undefined,
    a.accessToken
  );
});

await test('Reject messages after block', async () => {
  await api(
    'POST',
    `/conversations/${direct.id}/messages`,
    {
      clientMessageId: randomUUID(),
      content: 'Blocked message',
    },
    b.accessToken,
    403
  );
});

await test('Unblock participant', async () => {
  await api(
    'DELETE',
    `/blocks/${b.user.id}`,
    undefined,
    a.accessToken
  );
});

await test('Resume existing conversation after unblock', async () => {
  await api(
    'POST',
    `/conversations/${direct.id}/messages`,
    {
      clientMessageId: randomUUID(),
      content: 'We can talk again!',
    },
    b.accessToken,
    201
  );
});

console.log('\n========================================');
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
console.log(`TOTAL:  ${passed + failed}`);
console.log('========================================\n');

process.exitCode = failed > 0 ? 1 : 0;
