import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const base = process.env.TEST_API_URL;
const origin = 'http://localhost:5173';

if (
  process.env.ALLOW_INTEGRATION_TESTS !== '1' ||
  !base
) {
  throw new Error('Integration tests are not enabled');
}

const target = new URL(base);

if (!['127.0.0.1', 'localhost'].includes(target.hostname)) {
  throw new Error('Tests require an isolated local API');
}

let passed = 0;

function ok(name) {
  passed++;
  console.log(`PASS ${passed}: ${name}`);
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (options.origin !== null) {
    headers.Origin = options.origin ?? origin;
  }

  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'POST',
    headers,
    body: options.body
      ? JSON.stringify(options.body)
      : undefined,
  });

  return {
    status: response.status,
    body: await response.json(),
    cookies: response.headers.getSetCookie(),
    cacheControl: response.headers.get('cache-control'),
  };
}

function cookieJar(result) {
  return result.cookies
    .map(cookie => cookie.split(';')[0])
    .join('; ');
}

function refreshCookie(result) {
  const cookie = result.cookies.find(
    value => value.startsWith('mikoschat_refresh='),
  );

  assert.ok(cookie, 'Refresh cookie missing');
  return cookie;
}

function expiry(cookie) {
  const match = cookie.match(/Expires=([^;]+)/i);
  assert.ok(match, 'Cookie expiry missing');
  return Date.parse(match[1]);
}

const suffix = randomBytes(6).toString('hex');

const account = {
  username: `web_${suffix}`,
  email: `web_${suffix}@example.com`,
  displayName: 'Web Auth Test',
  password: randomBytes(24).toString('hex'),
};

const credentials = {
  identifier: account.username,
  password: account.password,
};

const registered = await request('/auth/web/register', {
  body: {
    ...account,
    remember: true,
  },
});

assert.equal(registered.status, 201);
assert.ok(registered.body.accessToken);
assert.ok(registered.body.sessionId);
ok('Browser registration');

assert.equal('refreshToken' in registered.body, false);
ok('Refresh token is not exposed in JSON');

const firstCookie = refreshCookie(registered);

assert.match(firstCookie, /;\s*HttpOnly/i);
assert.match(firstCookie, /;\s*Secure/i);
assert.match(firstCookie, /;\s*SameSite=Strict/i);
assert.match(firstCookie, /Path=\/api\/v1\/auth\/web/i);
ok('Secure cookie attributes');

assert.match(firstCookie, /Max-Age=\d+/i);
assert.ok(expiry(firstCookie) > Date.now());
ok('Persistent session cookie');

assert.equal(registered.cacheControl, 'no-store');
ok('Authentication responses are not cached');

const initialJar = cookieJar(registered);

const restored = await request('/auth/web/refresh', {
  cookie: initialJar,
});

assert.equal(restored.status, 200);
assert.equal(
  restored.body.sessionId,
  registered.body.sessionId,
);
assert.equal(
  restored.body.user.id,
  registered.body.user.id,
);
ok('Session restoration');

const rotatedJar = cookieJar(restored);

assert.notEqual(initialJar, rotatedJar);
ok('Refresh token rotation');

assert.ok(
  Math.abs(
    expiry(firstCookie) -
    expiry(refreshCookie(restored)),
  ) <= 2000,
);
ok('Original session expiration is preserved');

const replay = await request('/auth/web/refresh', {
  cookie: initialJar,
});

assert.equal(replay.status, 401);
ok('Old refresh token rejected');

const noOrigin = await request('/auth/web/refresh', {
  cookie: rotatedJar,
  origin: null,
});

assert.equal(noOrigin.status, 403);
ok('Missing Origin rejected');

const evilOrigin = await request('/auth/web/refresh', {
  cookie: rotatedJar,
  origin: 'https://untrusted.example',
});

assert.equal(evilOrigin.status, 403);
ok('Untrusted Origin rejected');

const concurrent = await Promise.all([
  request('/auth/web/refresh', {
    cookie: rotatedJar,
  }),
  request('/auth/web/refresh', {
    cookie: rotatedJar,
  }),
]);

assert.deepEqual(
  concurrent.map(result => result.status).sort(),
  [200, 401],
);
ok('Concurrent rotation permits only one winner');

const winner = concurrent.find(
  result => result.status === 200,
);

const activeJar = cookieJar(winner);

const logout = await request('/auth/web/logout', {
  cookie: activeJar,
});

assert.equal(logout.status, 200);
assert.ok(logout.cookies.some(
  value => value.startsWith('mikoschat_refresh=;'),
));
ok('Logout clears browser cookies');

const revokedRefresh = await request(
  '/auth/web/refresh',
  { cookie: activeJar },
);

assert.equal(revokedRefresh.status, 401);
ok('Logout revokes refresh token');

const revokedAccess = await request('/auth/me', {
  method: 'GET',
  token: winner.body.accessToken,
});

assert.equal(revokedAccess.status, 401);
ok('Logout revokes access token');

const temporary = await request('/auth/web/login', {
  body: {
    ...credentials,
    remember: false,
  },
});

assert.equal(temporary.status, 200);

assert.doesNotMatch(
  refreshCookie(temporary),
  /Max-Age=|Expires=/i,
);
ok('Temporary session cookie');

const temporaryRefresh = await request(
  '/auth/web/refresh',
  { cookie: cookieJar(temporary) },
);

assert.equal(temporaryRefresh.status, 200);

assert.doesNotMatch(
  refreshCookie(temporaryRefresh),
  /Max-Age=|Expires=/i,
);
ok('Temporary session remains temporary after rotation');

const mobile = await request('/auth/login', {
  body: credentials,
});

assert.equal(mobile.status, 200);
assert.ok(mobile.body.refreshToken);
ok('Mobile authentication compatibility');

const mobileRefresh = await request('/auth/refresh', {
  body: {
    refreshToken: mobile.body.refreshToken,
  },
});

assert.equal(mobileRefresh.status, 200);
assert.ok(mobileRefresh.body.refreshToken);
ok('Mobile refresh compatibility');

for (let i = 0; i < 3; i++) {
  const result = await request(
    i % 2 ? '/auth/login' : '/auth/web/login',
    {
      body: {
        ...credentials,
        password: 'invalid-password',
      },
    },
  );

  assert.equal(result.status, 401);
}

for (const path of [
  '/auth/login',
  '/auth/web/login',
]) {
  const result = await request(path, {
    body: credentials,
  });

  assert.equal(result.status, 429);
}

ok('Shared mobile and web login rate limit');

console.log(`\nAll ${passed} Web Auth tests passed.`);
