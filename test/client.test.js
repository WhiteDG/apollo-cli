import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupIsolatedHome,
  assertIsolated,
  fetchStub,
  jsonResponse,
  emptyResponse,
  redirectResponse,
  setEnv
} from './helpers.js';

const iso = setupIsolatedHome();
const client = await import('../src/client.js');
assertIsolated(iso);

beforeEach(() => {
  process.chdir(iso.home);
  rmSync(join(iso.home, '.apollo-cli'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

after(() => iso.cleanup());

const opts = { envName: 'dev', baseUrl: 'http://portal.test', cookie: 'JSESSIONID=c1' };

// ---- portalJSON 状态码与错误提取 ----

test('portalJSON：200 JSON 对象/数组直接解析', async t => {
  fetchStub(t, () => jsonResponse({ a: 1 }));
  assert.deepEqual(await client.portalJSON('GET', '/x', opts), { a: 1 });

  fetchStub(t, () => jsonResponse([1, 2]));
  assert.deepEqual(await client.portalJSON('GET', '/x', opts), [1, 2]);
});

test('portalJSON：200 空 body 返回 null', async t => {
  fetchStub(t, () => emptyResponse(200));
  assert.equal(await client.portalJSON('GET', '/x', opts), null);
});

test('portalJSON：200 非 JSON 抛截断信息', async t => {
  fetchStub(t, () => new Response('not-json', { status: 200 }));
  await assert.rejects(() => client.portalJSON('GET', '/x', opts), /响应解析失败: not-json/);
});

test('portalJSON：>=400 抛中文错误', async t => {
  fetchStub(t, () => jsonResponse({ message: 'boom' }, 400));
  await assert.rejects(() => client.portalJSON('GET', '/x', opts), /请求失败 \(400\): boom/);
});

test('portalJSON：错误消息优先级 message > exception > error', async t => {
  fetchStub(t, () => jsonResponse({ exception: 'exc', error: 'err' }, 400));
  await assert.rejects(() => client.portalJSON('GET', '/x', opts), /请求失败 \(400\): exc/);

  fetchStub(t, () => jsonResponse({ error: 'err-only' }, 400));
  await assert.rejects(() => client.portalJSON('GET', '/x', opts), /请求失败 \(400\): err-only/);
});

test('portalJSON：HTML 错误体去标签后截断', async t => {
  fetchStub(t, () => new Response('<html><body>boom</body></html>', { status: 500 }));
  await assert.rejects(() => client.portalJSON('GET', '/x', opts), /请求失败 \(500\): boom/);
});

test('portalJSON：>=400 空 body 回退为 HTTP status', async t => {
  fetchStub(t, () => emptyResponse(400));
  await assert.rejects(() => client.portalJSON('GET', '/x', opts), /请求失败 \(400\): HTTP 400/);
});

test('portalJSON：错误体是合法 JSON 但无 message 字段时回退原文', async t => {
  fetchStub(t, () => jsonResponse({}, 400));
  await assert.rejects(() => client.portalJSON('GET', '/x', opts), err => {
    return err.message === '请求失败 (400): {}';
  });
});

test('portalJSON：非 signin 的 302 抛重定向错误', async t => {
  fetchStub(t, () => redirectResponse('/apps'));
  await assert.rejects(() => client.portalJSON('GET', '/x', opts), /请求被重定向 \(302\) 到 \/apps/);
});

// ---- portalRequest 401/signin 重登矩阵 ----

test('portalRequest：401 且无凭据时抛指引错误', async t => {
  const calls = fetchStub(t, () => emptyResponse(401));
  await assert.rejects(
    () => client.portalJSON('GET', '/x', opts),
    /登录已过期，且未找到可用凭据。请执行 "apollo-cli login dev" 或配置 APOLLO_DEV_USERNAME\/PASSWORD/
  );
  assert.equal(calls.length, 1);
});

test('portalRequest：环境名含特殊字符时提示与实际读取一致的变量名', async t => {
  fetchStub(t, () => emptyResponse(401));
  await assert.rejects(
    () => client.portalJSON('GET', '/x', { ...opts, envName: 'fat-2' }),
    err => err.message.includes('APOLLO_FAT_2_USERNAME/PASSWORD') && !err.message.includes('FAT-2')
  );
});

test('portalRequest：401 且自动重登失败时带出失败原因', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: 'alice', APOLLO_DEV_PASSWORD: 'pw' });
  try {
    fetchStub(t, (record, idx) => (idx === 0 ? emptyResponse(401) : redirectResponse('/signin')));
    await assert.rejects(
      () => client.portalJSON('GET', '/x', opts),
      /自动重新登录失败：登录失败：用户名或密码错误/
    );
  } finally {
    restore();
  }
});

test('portalRequest：401 后重登成功并用新 cookie 重放一次', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: 'alice', APOLLO_DEV_PASSWORD: 'pw' });
  try {
    const calls = fetchStub(t, (record, idx) => {
      if (idx === 0) return emptyResponse(401);
      if (record.url.endsWith('/signin')) return redirectResponse('/apps', ['JSESSIONID=new; Path=/']);
      if (record.url.endsWith('/apps')) return jsonResponse([]);
      return jsonResponse({ ok: true });
    });
    const resp = await client.portalRequest('GET', '/apps/x', opts);
    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { ok: true });
    assert.equal(calls.length, 4);
    assert.equal(calls[1].url, 'http://portal.test/signin');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[2].url, 'http://portal.test/apps');
    assert.equal(calls[3].headers.cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=new');

    const session = JSON.parse(readFileSync(join(iso.home, '.apollo-cli', 'session.json'), 'utf8'));
    assert.equal(session.dev.baseUrl, 'http://portal.test');
    assert.equal(session.dev.username, 'alice');
    assert.equal(session.dev.cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=new');
    assert.equal(typeof session.dev.savedAt, 'number');
  } finally {
    restore();
  }
});

test('portalRequest：重放仍 401 时不再重登，交由上层报错', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: 'alice', APOLLO_DEV_PASSWORD: 'pw' });
  try {
    const calls = fetchStub(t, (record, idx) => {
      if (idx === 0 || idx === 3) return emptyResponse(401);
      if (record.url.endsWith('/signin')) return redirectResponse('/apps', ['JSESSIONID=new']);
      return jsonResponse([]);
    });
    await assert.rejects(() => client.portalJSON('GET', '/apps/x', opts), /请求失败 \(401\): HTTP 401/);
    assert.equal(calls.length, 4);
  } finally {
    restore();
  }
});

test('portalRequest：重放后仍 302→signin 时上层抛登录已过期', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: 'alice', APOLLO_DEV_PASSWORD: 'pw' });
  try {
    const calls = fetchStub(t, (record, idx) => {
      if (idx === 0) return emptyResponse(401);
      if (record.url.endsWith('/signin')) return redirectResponse('/apps', ['JSESSIONID=new']);
      if (record.url.endsWith('/apps')) return jsonResponse([]);
      return redirectResponse('/signin');
    });
    await assert.rejects(() => client.portalJSON('GET', '/apps/x', opts), /登录已过期，请重新登录/);
    assert.equal(calls.length, 4);
  } finally {
    restore();
  }
});

test('portalRequest：signin 重定向 + 有凭据时同样触发重登', async t => {
  const restore = setEnv({ APOLLO_DEV_USERNAME: 'alice', APOLLO_DEV_PASSWORD: 'pw' });
  try {
    const calls = fetchStub(t, (record, idx) => {
      if (idx === 0) return redirectResponse('/signin');
      if (record.url.endsWith('/signin')) return redirectResponse('/apps', ['JSESSIONID=new']);
      if (record.url.endsWith('/apps')) return jsonResponse([]);
      return jsonResponse({ ok: true });
    });
    assert.deepEqual(await client.portalJSON('GET', '/apps/x', opts), { ok: true });
    assert.equal(calls.length, 4);
  } finally {
    restore();
  }
});

test('portalRequest：403 不触发重登', async t => {
  const calls = fetchStub(t, () => emptyResponse(403));
  await assert.rejects(() => client.portalJSON('GET', '/x', opts), /请求失败 \(403\): HTTP 403/);
  assert.equal(calls.length, 1);
});

test('portalRequest：网络错误带 cause 码', async t => {
  fetchStub(t, () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  });
  await assert.rejects(
    () => client.portalJSON('GET', '/apps/x', opts),
    /无法连接 http:\/\/portal.test\/apps\/x（ECONNREFUSED）/
  );
});

test('portalRequest：网络错误无 cause 时省略括号', async t => {
  fetchStub(t, () => {
    throw new Error('boom');
  });
  await assert.rejects(() => client.portalJSON('GET', '/apps/x', opts), err => {
    return err.message === '无法连接 http://portal.test/apps/x';
  });
});

test('portalRequest：请求超时带超时文案', async t => {
  fetchStub(t, () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    throw err;
  });
  await assert.rejects(
    () => client.portalJSON('GET', '/apps/x', opts),
    /请求超时（30s 无响应）: http:\/\/portal.test\/apps\/x/
  );
});

// ---- body/content-type 规则 ----

test('portalRequest：GET/DELETE 带对象 body 时不发送 body 与 content-type', async t => {
  const calls = fetchStub(t, () => jsonResponse(null));
  await client.portalRequest('GET', '/x', { ...opts, body: { a: 1 } });
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers['content-type'], undefined);

  await client.portalRequest('DELETE', '/x', { ...opts, body: { a: 1 } });
  assert.equal(calls[1].body, undefined);
  assert.equal(calls[1].headers['content-type'], undefined);
});

test('portalRequest：POST 对象 body 序列化为 JSON 并带 content-type', async t => {
  const calls = fetchStub(t, () => jsonResponse(null));
  await client.portalRequest('POST', '/x', { ...opts, body: { a: 1 } });
  assert.equal(calls[0].headers['content-type'], 'application/json;charset=UTF-8');
  assert.equal(calls[0].body, '{"a":1}');
});
