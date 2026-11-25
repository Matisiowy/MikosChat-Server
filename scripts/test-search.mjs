import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';

const BASE = process.env.TEST_API_URL;

if (process.env.ALLOW_INTEGRATION_TESTS !== '1' || !BASE) {
  throw new Error('Explicit isolated test environment required');
}

const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');

let passed = 0;
let failed = 0;

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
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  assert.equal(
    res.status,
    expected,
    `${method} ${path}: HTTP ${res.status}, expected ${expected}`,
  );

  return res.json();
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
  }
}

async function register(name) {
  return api('POST', '/auth/register', {
    username: `search_${name}_${suffix}`,
    email: `search_${name}_${suffix}@example.com`,
    displayName: `Search Test ${name}`,
    password,
  }, undefined, 201);
}

async function makeFriends(a, b) {
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
}

async function direct(a, b) {
  return api(
    'POST',
    '/conversations/direct',
    { userId: b.user.id },
    a.accessToken,
    201,
  );
}

async function send(user, conversation, content) {
  return api(
    'POST',
    `/conversations/${conversation.id}/messages`,
    {
      clientMessageId: randomUUID(),
      content,
    },
    user.accessToken,
    201,
  );
}

async function search(user, conversation, q, limit, expected = 200) {
  const params = new URLSearchParams({ q });

  if (limit !== undefined) {
    params.set('limit', String(limit));
  }

  return api(
    'GET',
    `/conversations/${conversation.id}/messages/search?${params}`,
    undefined,
    user?.accessToken,
    expected,
  );
}

console.log('\n=== MIKOSCHAT MESSAGE SEARCH TESTS ===\n');

const a = await register('a');
const b = await register('b');
const c = await register('c');

await makeFriends(a, b);
await makeFriends(a, c);

const conversation = await direct(a, b);
const otherConversation = await direct(a, c);

const first = await send(a, conversation, 'Koncert jutro');
const second = await send(b, conversation, 'Wielki KONCERT');
const polish = await send(a, conversation, 'Zażółć gęślą jaźń');
const percent = await send(a, conversation, 'Gotowe w 100%');
const underscore = await send(a, conversation, 'test_value');
await send(a, conversation, 'testXvalue');
const deleted = await send(a, conversation, 'deleted_secret');

await send(a, otherConversation, 'Koncert prywatny');

await api(
  'DELETE',
  `/messages/${deleted.id}`,
  undefined,
  a.accessToken,
);

await test('Find existing message', async () => {
  const result = await search(a, conversation, 'Koncert jutro');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, first.id);
});

await test('Case insensitive search', async () => {
  const result = await search(a, conversation, 'koncert');
  assert.equal(result.items.length, 2);
});

await test('Substring search', async () => {
  const result = await search(a, conversation, 'ncer');
  assert.equal(result.items.length, 2);
});

await test('Polish characters', async () => {
  const result = await search(a, conversation, 'ZAŻÓŁĆ');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, polish.id);
});

await test('Literal percent character', async () => {
  const result = await search(a, conversation, '%');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, percent.id);
});

await test('Literal underscore character', async () => {
  const result = await search(a, conversation, '_');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, underscore.id);
});

await test('Exclude deleted messages', async () => {
  const result = await search(a, conversation, 'deleted_secret');
  assert.equal(result.items.length, 0);
});

await test('Conversation isolation', async () => {
  const result = await search(a, conversation, 'Koncert prywatny');
  assert.equal(result.items.length, 0);
});

await test('Reject outsider access', async () => {
  await search(c, conversation, 'koncert', undefined, 404);
});

await test('Reject unauthenticated access', async () => {
  await search(null, conversation, 'koncert', undefined, 401);
});

await test('Reject empty query', async () => {
  await search(a, conversation, '', undefined, 400);
  await search(a, conversation, '   ', undefined, 400);
});

await test('Reject oversized query', async () => {
  await search(a, conversation, 'x'.repeat(201), undefined, 400);
});

await test('Validate result limit', async () => {
  await search(a, conversation, 'koncert', 0, 400);
  await search(a, conversation, 'koncert', 51, 400);
  await search(a, conversation, 'koncert', 1.5, 400);
});

await test('Newest messages first', async () => {
  const result = await search(a, conversation, 'koncert');
  assert.equal(result.items[0].id, second.id);
  assert.equal(result.items[1].id, first.id);
});

await test('Result limit and hasMore', async () => {
  const result = await search(a, conversation, 'koncert', 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.hasMore, true);

  const all = await search(a, conversation, 'koncert', 50);
  assert.equal(all.hasMore, false);
});

await test('No matching messages', async () => {
  const result = await search(a, conversation, randomUUID());
  assert.equal(result.items.length, 0);
  assert.equal(result.hasMore, false);
});

await test('Trim search query', async () => {
  const result = await search(a, conversation, '  koncert  ');
  assert.equal(result.items.length, 2);
});

await test('Both participants can search', async () => {
  const result = await search(b, conversation, 'koncert');
  assert.equal(result.items.length, 2);
});

console.log('\n========================================');
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
console.log(`TOTAL:  ${passed + failed}`);
console.log('========================================\n');

process.exitCode = failed > 0 ? 1 : 0;
