import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupIsolatedHome,
  assertIsolated,
  fetchStub,
  jsonResponse,
  redirectResponse,
  seedSession,
  setEnv
} from './helpers.js';

const iso = setupIsolatedHome();
const auth = await import('../src/auth.js');
assertIsolated(iso);

const portal = 'http://portal.test';

beforeEach(() => {
  process.chdir(iso.home);
  rmSync(join(iso.home, '.apollo-cli'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(join(iso.home, '.env'), { force: true });
});

after(() => iso.cleanup());

// ---- resolveCredentials ----

test('resolveCredentials：--flag 优先级最高', () => {
  const restore = setEnv({
    APOLLO_DEV_USERNAME: 'env-u',
    APOLLO_DEV_PASSWORD: 'env-p',
    APOLLO_USERNAME: 'global-u',
    APOLLO_PASSWORD: 'global-p'
  });
  try {
    assert.deepEqual(auth.resolveCredentials('dev', { username: 'cu', password: 'cp' }), {
      username: 'cu',
      password: 'cp',
      from: '--flag'
    });
  } finally {
    restore();
  }
});

test('resolveCredentials：环境专属变量胜过全局变量', () => {
  const restore = setEnv({
    APOLLO_FAT_USERNAME: 'per-u',
    APOLLO_FAT_PASSWORD: 'per-p',
    APOLLO_USERNAME: 'global-u',
    APOLLO_PASSWORD: 'global-p'
  });
  try {
    assert.deepEqual(auth.resolveCredentials('fat', {}), {
      username: 'per-u',
      password: 'per-p',
      from: 'APOLLO_FAT_USERNAME'
    });
  } finally {
    restore();
  }
});

test('resolveCredentials：环境名规范化（非字母数字转下划线并大写）', () => {
  const restore = setEnv({
    APOLLO_FAT_2_USERNAME: 'u2',
    APOLLO_FAT_2_PASSWORD: 'p2',
    APOLLO_A_B_USERNAME: 'udot',
    APOLLO_A_B_PASSWORD: 'pdot'
  });
  try {
    assert.equal(auth.resolveCredentials('fat-2', {}).username, 'u2');
    assert.equal(auth.resolveCredentials('a.b', {}).username, 'udot');
  } finally {
    restore();
  }
});

test('resolveCredentials：专属变量只配一半时回退全局', () => {
  const restore = setEnv({ APOLLO_FAT_USERNAME: 'per-only', APOLLO_USERNAME: 'g-u', APOLLO_PASSWORD: 'g-p' });
  try {
    assert.deepEqual(auth.resolveCredentials('fat', {}), { username: 'g-u', password: 'g-p', from: 'APOLLO_USERNAME' });
  } finally {
    restore();
  }
});

test('resolveCredentials：仅全局变量', () => {
  const restore = setEnv({ APOLLO_USERNAME: 'g-u', APOLLO_PASSWORD: 'g-p' });
  try {
    assert.deepEqual(auth.resolveCredentials('dev', {}), { username: 'g-u', password: 'g-p', from: 'APOLLO_USERNAME' });
  } finally {
    restore();
  }
});

test('resolveCredentials：仅 --username 时 password 为空串', () => {
  assert.deepEqual(auth.resolveCredentials('dev', { username: 'u' }), { username: 'u', password: '', from: '--username' });
  assert.deepEqual(auth.resolveCredentials('dev', { username: 'u', password: '' }), {
    username: 'u',
    password: '',
    from: '--username'
  });
});

test('resolveCredentials：--password 单独提供无效，全无凭据返回 null', () => {
  assert.equal(auth.resolveCredentials('dev', { password: 'p' }), null);
  assert.equal(auth.resolveCredentials('dev', {}), null);
});

// ---- extractCookie ----

test('extractCookie：无 JSESSIONID 返回 null', () => {
  const headers = new Headers();
  headers.append('set-cookie', 'NG_TRANSLATE_LANG_KEY=zh-CN; Path=/');
  assert.equal(auth.extractCookie(headers), null);
});

test('extractCookie：有 JSESSIONID 时补齐 NG_TRANSLATE_LANG_KEY 前缀', () => {
  const headers = new Headers();
  headers.append('set-cookie', 'JSESSIONID=abc; Path=/');
  assert.equal(auth.extractCookie(headers), 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=abc');
});

test('extractCookie：已含 NG_TRANSLATE_LANG_KEY 时原样连接多条 cookie', () => {
  const headers = new Headers();
  headers.append('set-cookie', 'JSESSIONID=abc; Path=/');
  headers.append('set-cookie', 'NG_TRANSLATE_LANG_KEY=zh-CN');
  assert.equal(auth.extractCookie(headers), 'JSESSIONID=abc; NG_TRANSLATE_LANG_KEY=zh-CN');
});

test('extractCookie：getSetCookie 不可用时的回退切分（Expires 逗号不误切）', () => {
  const fake = {
    getSetCookie: undefined,
    get: name =>
      name === 'set-cookie'
        ? 'a=1; Path=/, JSESSIONID=x; Path=/, b=2; Expires=Wed, 21 Oct 2015 07:28:00 GMT'
        : null
  };
  assert.equal(auth.extractCookie(fake), 'NG_TRANSLATE_LANG_KEY=zh-CN; a=1; JSESSIONID=x; b=2');
});

test('extractCookie：getSetCookie 抛异常时走回退', () => {
  const fake = {
    getSetCookie() {
      throw new Error('boom');
    },
    get: () => 'JSESSIONID=z; Path=/'
  };
  assert.equal(auth.extractCookie(fake), 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=z');
});

// ---- login ----

test('login：成功返回 cookie，并携带正确的请求细节', async t => {
  const calls = fetchStub(t, (record, idx) =>
    idx === 0 ? redirectResponse('/apps', ['JSESSIONID=abc; Path=/']) : jsonResponse([])
  );
  const cookie = await auth.login('dev', { username: 'alice', password: 'pw' }, portal);
  assert.equal(cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=abc');
  assert.equal(calls[0].url, `${portal}/signin`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[0].headers.referer, `${portal}/signin`);
  assert.equal(calls[0].headers.cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN');
  assert.equal(calls[0].body.toString(), 'username=alice&password=pw&login-submit=%E7%99%BB%E5%BD%95');
  assert.equal(calls[1].url, `${portal}/apps`);
  assert.equal(calls[1].headers.cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=abc');
});

test('login：非 302 返回 HTTP 状态错误', async t => {
  fetchStub(t, () => jsonResponse({}, 200));
  await assert.rejects(
    () => auth.login('dev', { username: 'u', password: 'p' }, portal),
    /登录失败：Portal 返回 HTTP 200（http:\/\/portal.test）/
  );
});

test('login：302 无 JSESSIONID 视为密码错误', async t => {
  fetchStub(t, () => redirectResponse('/apps'));
  await assert.rejects(() => auth.login('dev', { username: 'u', password: 'p' }, portal), /登录失败：用户名或密码错误/);
});

test('login：302 跳回 signin 视为密码错误', async t => {
  fetchStub(t, () => redirectResponse('/signin', ['JSESSIONID=abc']));
  await assert.rejects(() => auth.login('dev', { username: 'u', password: 'p' }, portal), /登录失败：用户名或密码错误/);
});

test('login：请求失败抛无法连接', async t => {
  fetchStub(t, () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  });
  await assert.rejects(
    () => auth.login('dev', { username: 'u', password: 'p' }, portal),
    /无法连接 http:\/\/portal.test（ECONNREFUSED）/
  );
});

test('login：请求超时抛超时文案', async t => {
  fetchStub(t, () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    throw err;
  });
  await assert.rejects(
    () => auth.login('dev', { username: 'u', password: 'p' }, portal),
    /请求超时（30s 无响应）: http:\/\/portal.test/
  );
});

test('login：校验步超时带验证失败后缀', async t => {
  fetchStub(t, (record, idx) => {
    if (idx === 0) return redirectResponse('/apps', ['JSESSIONID=abc']);
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    throw err;
  });
  await assert.rejects(
    () => auth.login('dev', { username: 'u', password: 'p' }, portal),
    /请求超时（30s 无响应）: http:\/\/portal.test（验证登录状态失败）/
  );
});

test('login：校验步跳回 signin 抛 cookie 无效', async t => {
  fetchStub(t, (record, idx) =>
    idx === 0 ? redirectResponse('/apps', ['JSESSIONID=abc']) : redirectResponse('/signin')
  );
  await assert.rejects(
    () => auth.login('dev', { username: 'u', password: 'p' }, portal),
    /登录验证失败：cookie 无效或凭据有误/
  );
});

test('login：校验步返回非 signin 重定向时仍视为登录成功（现状锁定）', async t => {
  fetchStub(t, (record, idx) =>
    idx === 0 ? redirectResponse('/apps', ['JSESSIONID=abc']) : redirectResponse('/other')
  );
  const cookie = await auth.login('dev', { username: 'u', password: 'p' }, portal);
  assert.equal(cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=abc');
});

test('login：校验步网络错误带 cause 文案', async t => {
  fetchStub(t, (record, idx) => {
    if (idx === 0) return redirectResponse('/apps', ['JSESSIONID=abc']);
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ENOTFOUND' };
    throw err;
  });
  await assert.rejects(
    () => auth.login('dev', { username: 'u', password: 'p' }, portal),
    /无法连接 http:\/\/portal.test（ENOTFOUND）（验证登录状态失败）/
  );
});

test('login：校验步网络错误无 cause 时省略括号', async t => {
  fetchStub(t, (record, idx) => {
    if (idx === 0) return redirectResponse('/apps', ['JSESSIONID=abc']);
    throw new Error('boom');
  });
  await assert.rejects(() => auth.login('dev', { username: 'u', password: 'p' }, portal), err => {
    return err.message === '无法连接 http://portal.test（验证登录状态失败）';
  });
});

// ---- ensureSession ----

test('ensureSession：session 命中且 baseUrl 一致时直接返回，不发请求', async t => {
  seedSession(iso.home, 'dev', { baseUrl: portal, cookie: 'sess-cookie' });
  const calls = fetchStub(t, () => {
    throw new Error('不应发起请求');
  });
  assert.equal(await auth.ensureSession('dev', portal, {}), 'sess-cookie');
  assert.equal(calls.length, 0);
});

test('ensureSession：baseUrl 不匹配且无凭据时抛未登录指引', async t => {
  seedSession(iso.home, 'dev', { baseUrl: 'http://other', cookie: 'old' });
  fetchStub(t, () => {
    throw new Error('不应发起请求');
  });
  await assert.rejects(
    () => auth.ensureSession('dev', portal, {}),
    /未登录，请先执行 "apollo-cli login dev" 或设置 APOLLO_DEV_USERNAME\/PASSWORD/
  );
});

test('ensureSession：环境名含特殊字符时提示与实际读取一致的变量名', async t => {
  fetchStub(t, () => {
    throw new Error('不应发起请求');
  });
  await assert.rejects(
    () => auth.ensureSession('fat-2', portal, {}),
    err => err.message.includes('APOLLO_FAT_2_USERNAME/PASSWORD') && !err.message.includes('FAT-2')
  );
});

test('ensureSession：无 session 但环境变量有凭据时自动登录并落盘', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: 'alice', APOLLO_DEV_PASSWORD: 'pw' });
  try {
    fetchStub(t, (record, idx) =>
      idx === 0 ? redirectResponse('/apps', ['JSESSIONID=auto']) : jsonResponse([])
    );
    const cookie = await auth.ensureSession('dev', portal, {});
    assert.equal(cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=auto');
    const session = JSON.parse(readFileSync(join(iso.home, '.apollo-cli', 'session.json'), 'utf8'));
    assert.equal(session.dev.baseUrl, portal);
    assert.equal(session.dev.username, 'alice');
    assert.equal(session.dev.cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=auto');
    assert.equal(typeof session.dev.savedAt, 'number');
  } finally {
    restore();
  }
});

test('ensureSession：cwd 的 .env 提供凭据（loadDotEnv 集成）', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: undefined, APOLLO_DEV_PASSWORD: undefined });
  try {
    writeFileSync(join(iso.home, '.env'), 'APOLLO_DEV_USERNAME=envuser\nAPOLLO_DEV_PASSWORD=envpw\n', 'utf8');
    const calls = fetchStub(t, (record, idx) =>
      idx === 0 ? redirectResponse('/apps', ['JSESSIONID=fromenv']) : jsonResponse([])
    );
    const cookie = await auth.ensureSession('dev', portal, {});
    assert.equal(cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=fromenv');
    assert.equal(calls[0].url, `${portal}/signin`);
  } finally {
    rmSync(join(iso.home, '.env'), { force: true });
    restore();
  }
});

// ---- reLogin ----

test('reLogin：无凭据返回 null 且不发请求', async t => {
  const calls = fetchStub(t, () => {
    throw new Error('不应发起请求');
  });
  assert.equal(await auth.reLogin('dev', portal), null);
  assert.equal(calls.length, 0);
});

test('reLogin：成功返回 {cookie} 并落盘 session', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: 'alice', APOLLO_DEV_PASSWORD: 'pw' });
  try {
    fetchStub(t, (record, idx) =>
      idx === 0 ? redirectResponse('/apps', ['JSESSIONID=relog']) : jsonResponse([])
    );
    const result = await auth.reLogin('dev', portal);
    assert.equal(result.cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=relog');
    const session = JSON.parse(readFileSync(join(iso.home, '.apollo-cli', 'session.json'), 'utf8'));
    assert.equal(session.dev.cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=relog');
  } finally {
    restore();
  }
});

test('reLogin：登录失败返回 {error} 不抛异常', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: 'alice', APOLLO_DEV_PASSWORD: 'pw' });
  try {
    fetchStub(t, () => jsonResponse({}, 200));
    const result = await auth.reLogin('dev', portal);
    assert.deepEqual(result, { error: '登录失败：Portal 返回 HTTP 200（http://portal.test）' });
  } finally {
    restore();
  }
});

test('reLogin：网络异常返回 {error} 不抛异常', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: 'alice', APOLLO_DEV_PASSWORD: 'pw' });
  try {
    fetchStub(t, () => {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    });
    const result = await auth.reLogin('dev', portal);
    assert.deepEqual(result, { error: '无法连接 http://portal.test（ECONNREFUSED）' });
  } finally {
    restore();
  }
});
