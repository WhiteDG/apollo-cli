import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from '../src/http.js';

test('fetchWithTimeout：附加 AbortSignal 超时并透传 options', async t => {
  let captured;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    captured = { url: String(url), init };
    return new Response('{}');
  });
  await http.fetchWithTimeout('http://p/x', { method: 'POST', headers: { a: 'b' } });
  assert.equal(captured.url, 'http://p/x');
  assert.equal(captured.init.method, 'POST');
  assert.deepEqual(captured.init.headers, { a: 'b' });
  assert.ok(captured.init.signal instanceof AbortSignal);
});

test('fetchWithTimeout：合并调用方 signal，不吞取消能力', async t => {
  let captured;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    captured = init;
    return new Response('{}');
  });
  const ctrl = new AbortController();
  await http.fetchWithTimeout('http://p/x', { signal: ctrl.signal });
  assert.notEqual(captured.signal, ctrl.signal, '不应原样覆盖调用方 signal');
  assert.equal(captured.signal.aborted, false);
  ctrl.abort();
  assert.equal(captured.signal.aborted, true, '调用方 abort 后合并 signal 应同步中止');
});

test('netError：超时与连接失败文案', () => {
  const timeout = new Error('timed out');
  timeout.name = 'TimeoutError';
  assert.equal(http.netError(timeout, 'http://p/x'), '请求超时（30s 无响应）: http://p/x');

  const conn = new TypeError('fetch failed');
  conn.cause = { code: 'ECONNREFUSED' };
  assert.equal(http.netError(conn, 'http://p/x'), '无法连接 http://p/x（ECONNREFUSED）');

  assert.equal(http.netError(new Error('boom'), 'http://p/x'), '无法连接 http://p/x');
});

test('isTimeout：只识别 TimeoutError', () => {
  const timeout = new Error('t');
  timeout.name = 'TimeoutError';
  assert.equal(http.isTimeout(timeout), true);
  assert.equal(http.isTimeout(new Error('boom')), false);
  assert.equal(http.isTimeout(undefined), false);
});
