import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

const HOST = 'http://127.0.0.1:3000';
const BASE = HOST + '/api/v1';

const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');

let passed = 0;
let failed = 0;
let token;
let avatarUrl;
let oldUrl;

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

async function api(method, path, body, auth = token) {
  const headers = {};

  if (auth) {
    headers.Authorization = `Bearer ${auth}`;
  }

  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  return fetch(BASE + path, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(15000),
  });
}

async function upload(buffer, mime, auth = token) {
  const form = new FormData();

  form.append(
    'file',
    new Blob([buffer], { type: mime }),
    'avatar.png',
  );

  return api(
    'POST',
    '/users/me/avatar',
    form,
    auth,
  );
}

const image = await sharp({
  create: {
    width: 800,
    height: 600,
    channels: 3,
    background: '#7367f0',
  },
}).png().toBuffer();

console.log('\n=== MIKOSCHAT AVATAR TESTS ===\n');

try {
  await test('Register test user', async () => {
    const res = await api('POST', '/auth/register', {
      username: `avatar_${suffix}`,
      email: `avatar_${suffix}@example.com`,
      displayName: 'Avatar Test',
      password,
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    token = data.accessToken;
    assert.ok(token);
  });

  await test('Unauthenticated upload rejected', async () => {
    const res = await upload(image, 'image/png', null);
    assert.equal(res.status, 401);
  });

  await test('Upload valid PNG image', async () => {
    const res = await upload(image, 'image/png');
    assert.equal(res.status, 200);

    const data = await res.json();
    avatarUrl = data.avatarUrl;

    assert.match(
      avatarUrl,
      /^\/api\/v1\/media\/avatars\/[a-f0-9-]+\.webp$/,
    );
  });

  await test('Avatar URL persisted in profile', async () => {
    const res = await api('GET', '/auth/me');
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.avatarUrl, avatarUrl);
  });

  await test('Public avatar accessible', async () => {
    const res = await fetch(HOST + avatarUrl);
    assert.equal(res.status, 200);
    assert.match(
      res.headers.get('content-type'),
      /image\/webp/,
    );
  });

  await test('Image converted to 512x512 WebP', async () => {
    const res = await fetch(HOST + avatarUrl);

    const metadata = await sharp(
      Buffer.from(await res.arrayBuffer()),
    ).metadata();

    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.exif, undefined);
  });

  await test('Invalid image rejected', async () => {
    const res = await upload(
      Buffer.from('This is not an image'),
      'image/png',
    );

    assert.equal(res.status, 400);
  });

  await test('Oversized image rejected', async () => {
    const res = await upload(
      Buffer.alloc(6 * 1024 * 1024),
      'image/png',
    );

    assert.equal(res.status, 413);
  });

  await test('Failed uploads preserve current avatar', async () => {
    const res = await api('GET', '/auth/me');
    const data = await res.json();

    assert.equal(data.avatarUrl, avatarUrl);
  });

  console.log('[WAIT] Waiting 65 seconds for upload rate limit...');
  await new Promise(resolve => setTimeout(resolve, 65000));

  await test('Replace avatar with new image', async () => {
    oldUrl = avatarUrl;

    const res = await upload(image, 'image/png');
    assert.equal(res.status, 200);

    const data = await res.json();
    avatarUrl = data.avatarUrl;

    assert.notEqual(avatarUrl, oldUrl);
  });

  await test('Previous avatar removed from storage', async () => {
    const res = await fetch(HOST + oldUrl);
    assert.equal(res.status, 404);
  });

  await test('Unauthenticated deletion rejected', async () => {
    const res = await api(
      'DELETE',
      '/users/me/avatar',
      undefined,
      null,
    );

    assert.equal(res.status, 401);
  });

  await test('Delete current avatar', async () => {
    const res = await api(
      'DELETE',
      '/users/me/avatar',
    );

    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.avatarUrl, null);
  });

  await test('Profile avatar cleared', async () => {
    const res = await api('GET', '/auth/me');
    const data = await res.json();

    assert.equal(data.avatarUrl, null);
  });

  await test('Deleted avatar no longer accessible', async () => {
    const res = await fetch(HOST + avatarUrl);
    assert.equal(res.status, 404);
  });

  await test('Repeated deletion is idempotent', async () => {
    const res = await api(
      'DELETE',
      '/users/me/avatar',
    );

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.avatarUrl, null);
  });

  await test('Invalid media filename rejected', async () => {
    const res = await fetch(
      BASE + '/media/avatars/test.txt',
    );

    assert.equal(res.status, 404);
  });

} catch {
  console.log('\nTest suite stopped after failure.');
} finally {
  if (token) {
    await api('DELETE', '/users/me/avatar').catch(() => {});
    await api('POST', '/auth/logout').catch(() => {});
  }
}

console.log('\n========================================');
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
console.log(`TOTAL:  ${passed + failed}`);
console.log('========================================\n');

process.exitCode = failed > 0 ? 1 : 0;
