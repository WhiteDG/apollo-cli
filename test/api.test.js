import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupIsolatedHome, assertIsolated, fetchStub, jsonResponse } from './helpers.js';

const iso = setupIsolatedHome();
const api = await import('../src/api.js');
assertIsolated(iso);

after(() => iso.cleanup());

const base = { envName: 'dev', baseUrl: 'http://portal.test', cookie: 'JSESSIONID=c1' };

test('api：getNamespaces 拼 URL、透传 cookie、GET 无 body', async t => {
  const calls = fetchStub(t, () => jsonResponse([{ a: 1 }]));
  const data = await api.getNamespaces('My App', 'UAT', 'default', base);
  assert.deepEqual(data, [{ a: 1 }]);
  assert.equal(calls[0].url, 'http://portal.test/apps/My%20App/envs/UAT/clusters/default/namespaces');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].headers.cookie, 'JSESSIONID=c1');
  assert.equal(calls[0].headers['content-type'], undefined);
  assert.equal(calls[0].body, undefined);
});

test('api：getItems 对 appId/ns 做 URI 编码（含中文与斜杠）', async t => {
  const calls = fetchStub(t, () => jsonResponse([]));
  await api.getItems('应用', 'DEV', 'default', 'a/b', base);
  assert.equal(
    calls[0].url,
    `http://portal.test/apps/${encodeURIComponent('应用')}/envs/DEV/clusters/default/namespaces/a%2Fb/items`
  );
});

test('api：createItem 用 POST 发送 JSON body', async t => {
  const data = { key: 'k', value: 'v', comment: '', dataChangeCreatedBy: 'alice' };
  const calls = fetchStub(t, () => jsonResponse({ ok: true }));
  const result = await api.createItem('app', 'DEV', 'default', 'application', data, base);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'http://portal.test/apps/app/envs/DEV/clusters/default/namespaces/application/item');
  assert.equal(calls[0].headers['content-type'], 'application/json;charset=UTF-8');
  assert.equal(calls[0].body, JSON.stringify(data));
});

test('api：updateItem 用 PUT 发送 JSON body 并返回解析结果', async t => {
  const data = { id: 1, key: 'k', value: 'v2' };
  const calls = fetchStub(t, () => jsonResponse({ ok: true }));
  const result = await api.updateItem('app', 'DEV', 'default', 'application', data, base);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url, 'http://portal.test/apps/app/envs/DEV/clusters/default/namespaces/application/item');
  assert.equal(calls[0].body, JSON.stringify(data));
});

test('api：deleteItem 用 DELETE 且 operator 编码在查询串，无 body', async t => {
  const calls = fetchStub(t, () => jsonResponse({ ok: true }));
  const result = await api.deleteItem('app', 'DEV', 'default', 'application', 42, 'alice x', base);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(
    calls[0].url,
    'http://portal.test/apps/app/envs/DEV/clusters/default/namespaces/application/items/42?operator=alice%20x'
  );
  assert.equal(calls[0].headers['content-type'], undefined);
  assert.equal(calls[0].body, undefined);
});

test('api：publishRelease 的 body 字段映射与 emergencyPublish 布尔化', async t => {
  const calls = fetchStub(t, () => jsonResponse({ id: 1 }));
  await api.publishRelease(
    'app',
    'DEV',
    'default',
    'application',
    { title: 'v1', comment: 'c', releasedBy: 'bob', emergency: true },
    base
  );
  assert.equal(calls[0].url, 'http://portal.test/apps/app/envs/DEV/clusters/default/namespaces/application/releases');
  assert.deepEqual(JSON.parse(calls[0].body), {
    appId: 'app',
    env: 'DEV',
    clusterName: 'default',
    namespaceName: 'application',
    releaseTitle: 'v1',
    releaseComment: 'c',
    releasedBy: 'bob',
    emergencyPublish: true
  });
});

test('api：publishRelease 缺省字段回退（comment/releasedBy 空串、emergency 为 false）', async t => {
  const calls = fetchStub(t, () => jsonResponse({ id: 2 }));
  await api.publishRelease('app', 'DEV', 'default', 'application', { title: 't' }, base);
  assert.deepEqual(JSON.parse(calls[0].body), {
    appId: 'app',
    env: 'DEV',
    clusterName: 'default',
    namespaceName: 'application',
    releaseTitle: 't',
    releaseComment: '',
    releasedBy: '',
    emergencyPublish: false
  });
});

test('api：getActiveReleases 分页参数进 URL', async t => {
  const calls = fetchStub(t, () => jsonResponse([]));
  await api.getActiveReleases('app', 'DEV', 'default', 'application', 7, base);
  assert.equal(calls[0].method, 'GET');
  assert.equal(
    calls[0].url,
    'http://portal.test/apps/app/envs/DEV/clusters/default/namespaces/application/releases/histories?page=0&size=7'
  );
});

test('api：baseUrl 末尾斜杠被去除', async t => {
  const calls = fetchStub(t, () => jsonResponse([]));
  await api.getNamespaces('app', 'DEV', 'default', { ...base, baseUrl: 'http://p/' });
  assert.equal(calls[0].url, 'http://p/apps/app/envs/DEV/clusters/default/namespaces');
});
