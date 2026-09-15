import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupIsolatedHome,
  assertIsolated,
  withOutput,
  fetchStub,
  jsonResponse,
  emptyResponse,
  seedUserConfig,
  seedProjectConfig,
  seedSession,
  setEnv,
  writeJSONFile,
  fileNsHandler
} from './helpers.js';

const iso = setupIsolatedHome();
const commands = await import('../src/commands.js');
assertIsolated(iso);

const portal = 'http://portal.test';
const userConfigFile = join(iso.home, '.apollo-cli', 'config.json');
const sessionFile = join(iso.home, '.apollo-cli', 'session.json');

function readJSON(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function seedDev({ session = { baseUrl: portal, cookie: 'sess-cookie', username: 'alice', savedAt: 1 } } = {}) {
  seedUserConfig(iso.home, {
    default: 'dev',
    environments: { dev: { baseUrl: portal, portalEnv: 'DEV', cluster: 'default' } }
  });
  if (session) seedSession(iso.home, 'dev', session);
}

beforeEach(() => {
  process.chdir(iso.home);
  rmSync(join(iso.home, '.apollo-cli'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(join(iso.home, 'apollo-cli.config.json'), { force: true });
  rmSync(join(iso.home, '.env'), { force: true });
});

after(() => iso.cleanup());

// ---- env ----

test('envList：空环境非 json 给出添加指引', async () => {
  const { stdout } = await withOutput(() => commands.envList({}));
  assert.equal(stdout, '未配置环境。使用 "apollo-cli env add <name> --base-url <url>" 添加\n');
});

test('envList：空环境 json 输出空数组', async () => {
  const { stdout } = await withOutput(() => commands.envList({ json: true }));
  assert.equal(stdout, '[]\n');
});

test('envList：表格显示默认标记与已登录状态', async () => {
  seedUserConfig(iso.home, { default: 'fat', environments: { fat: { baseUrl: 'http://p' } } });
  seedSession(iso.home, 'fat', { baseUrl: 'http://p', cookie: 'c' });
  const { stdout } = await withOutput(() => commands.envList({}));
  const expected =
    '环境  baseUrl   Apollo环境  默认  已登录\n' +
    '─'.repeat(40) +
    '\n' +
    'fat   http://p  FAT         ✓     是    \n';
  assert.equal(stdout, expected);
});

test('envList：session baseUrl 不匹配显示未登录', async () => {
  seedUserConfig(iso.home, { default: 'fat', environments: { fat: { baseUrl: 'http://p' } } });
  seedSession(iso.home, 'fat', { baseUrl: 'http://other', cookie: 'c' });
  const { stdout } = await withOutput(() => commands.envList({}));
  assert.match(stdout, /fat   http:\/\/p  FAT         ✓     否    \n$/);
});

test('envAdd：去尾斜杠并落盘默认 portalEnv/cluster', async () => {
  const { stdout } = await withOutput(() => commands.envAdd('fat', { 'base-url': 'http://p/' }));
  assert.equal(stdout, '环境 "fat" 已添加 (portal: FAT, cluster: default)\n');
  assert.deepEqual(readJSON(userConfigFile), {
    environments: { fat: { baseUrl: 'http://p', portalEnv: 'FAT', cluster: 'default' } }
  });
});

test('envAdd：显式 portal-env/cluster 生效', async () => {
  const { stdout } = await withOutput(() =>
    commands.envAdd('fat', { 'base-url': 'http://p', 'portal-env': 'FAT_PROD', cluster: 'c1' })
  );
  assert.equal(stdout, '环境 "fat" 已添加 (portal: FAT_PROD, cluster: c1)\n');
  assert.equal(readJSON(userConfigFile).environments.fat.cluster, 'c1');
});

test('envAdd：--default 追加默认环境提示并写入默认值', async () => {
  const { stdout } = await withOutput(() => commands.envAdd('fat', { 'base-url': 'http://p', default: true }));
  assert.match(stdout, /^环境 "fat" 已添加 \(portal: FAT, cluster: default\)\n默认环境已设为 "fat"（已写入用户配置: .*config\.json）\n$/);
  assert.equal(readJSON(userConfigFile).default, 'fat');
});

test('envAdd：配置文件损坏时预检抛错且不写入', async () => {
  writeJSONFile(userConfigFile, {});
  writeFileSync(userConfigFile, '{broken', 'utf8');
  await assert.rejects(withOutput(() => commands.envAdd('fat', { 'base-url': 'http://p' })), /配置文件损坏/);
  assert.equal(readFileSync(userConfigFile, 'utf8'), '{broken');
});

test('envRm：环境不存在时报错', async () => {
  await assert.rejects(withOutput(() => commands.envRm('ghost')), /环境 "ghost" 不存在/);
});

test('envRm：删除用户配置并清除登录状态', async () => {
  seedDev();
  const { stdout } = await withOutput(() => commands.envRm('dev'));
  assert.equal(stdout, '环境 "dev" 已删除（从用户配置中移除）\n');
  assert.deepEqual(readJSON(userConfigFile).environments, {});
  assert.deepEqual(readJSON(sessionFile), {});
});

test('envRm：用户与项目配置同时命中', async () => {
  seedDev();
  const caseDir = iso.caseDir();
  seedProjectConfig(caseDir, { default: 'dev', environments: { dev: { baseUrl: 'http://p' } } });
  process.chdir(caseDir);
  const { stdout } = await withOutput(() => commands.envRm('dev'));
  assert.equal(stdout, '环境 "dev" 已删除（从用户配置、项目配置中移除）\n');
});

test('envRm：仅项目配置且用户目录不存在时正常删除（回归 clearSession ENOENT）', async () => {
  const caseDir = iso.caseDir();
  seedProjectConfig(caseDir, { environments: { dev: { baseUrl: 'http://p' } } });
  process.chdir(caseDir);
  assert.equal(existsSync(join(iso.home, '.apollo-cli')), false);
  const { stdout } = await withOutput(() => commands.envRm('dev'));
  assert.equal(stdout, '环境 "dev" 已删除（从项目配置中移除）\n');
  assert.equal(existsSync(join(iso.home, '.apollo-cli')), false);
});

test('envDefault：环境不存在时报错', async () => {
  seedDev();
  await assert.rejects(withOutput(() => commands.envDefault('ghost')), /环境 "ghost" 不存在/);
});

test('envDefault：成功写入用户配置并输出路径', async () => {
  seedUserConfig(iso.home, { environments: { fat: { baseUrl: 'http://p' } } });
  const { stdout } = await withOutput(() => commands.envDefault('fat'));
  assert.match(stdout, /^默认环境已设为 "fat"（已写入用户配置: .*config\.json）\n$/);
  assert.equal(readJSON(userConfigFile).default, 'fat');
});

test('logout：清除指定环境登录状态', async () => {
  seedDev();
  const { stdout } = await withOutput(() => commands.logout(null, {}));
  assert.equal(stdout, '已清除 dev 的登录状态\n');
  assert.deepEqual(readJSON(sessionFile), {});
});

test('login：环境名含特殊字符时提示与实际读取一致的变量名', async () => {
  seedUserConfig(iso.home, {
    default: 'fat-2',
    environments: { 'fat-2': { baseUrl: portal, portalEnv: 'FAT_2' } }
  });
  await assert.rejects(withOutput(() => commands.login(null, {})), err => {
    return err.message.includes('APOLLO_FAT_2_USERNAME/PASSWORD') && !err.message.includes('FAT-2');
  });
});

// ---- ns ----

test('nsList：字段回退与类型映射，配置数取 items 数量而非 itemModifiedCnt', async t => {
  seedDev();
  const calls = fetchStub(t, () =>
    jsonResponse([
      {
        baseInfo: { namespaceName: 'application' },
        format: 'properties',
        isPublic: true,
        itemModifiedCnt: 9,
        items: [{ key: 'a' }, { key: 'b' }]
      },
      { namespaceName: 'custom.ns', isPublic: false },
      { baseInfo: { namespaceName: 'x' }, format: 'yaml', isPublic: 0, items: [] }
    ])
  );
  const { stdout } = await withOutput(() => commands.nsList('MyApp', { json: true }));
  assert.equal(calls[0].url, `${portal}/apps/MyApp/envs/DEV/clusters/default/namespaces`);
  assert.deepEqual(JSON.parse(stdout), [
    { appId: 'MyApp', 命名空间: 'application', 格式: 'properties', 类型: '公共', 配置数: 2 },
    { appId: 'MyApp', 命名空间: 'custom.ns', 格式: 'properties', 类型: '私有', 配置数: '-' },
    { appId: 'MyApp', 命名空间: 'x', 格式: 'yaml', 类型: '私有', 配置数: 0 }
  ]);
});

test('nsList：空数组与非数组均输出提示', async t => {
  seedDev();
  fetchStub(t, () => jsonResponse([]));
  const empty = await withOutput(() => commands.nsList('MyApp', {}));
  assert.equal(empty.stdout, '没有命名空间\n');

  fetchStub(t, () => jsonResponse({}));
  const notArray = await withOutput(() => commands.nsList('MyApp', {}));
  assert.equal(notArray.stdout, '没有命名空间\n');
});

test('nsList：网络错误被 fatal 重抛', async t => {
  seedDev();
  fetchStub(t, () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  });
  await assert.rejects(
    withOutput(() => commands.nsList('MyApp', {})),
    /无法连接 http:\/\/portal.test\/apps\/MyApp\/envs\/DEV\/clusters\/default\/namespaces（ECONNREFUSED）/
  );
});

// ---- config ----

test('configList：行映射回退（修改人/修改时间取创建字段）', async t => {
  seedDev();
  fetchStub(t, () =>
    jsonResponse([
      { key: 'k1', value: 'v1', comment: 'c1', dataChangeLastModifiedBy: 'bob', dataChangeLastModifiedTime: 'T1' },
      { key: 'k2', value: 'v2', dataChangeCreatedBy: 'carol', dataChangeCreatedTime: 'T2' }
    ])
  );
  const { stdout } = await withOutput(() => commands.configList('app', { json: true }));
  assert.deepEqual(JSON.parse(stdout), [
    { key: 'k1', value: 'v1', 注释: 'c1', 修改人: 'bob', 修改时间: 'T1' },
    { key: 'k2', value: 'v2', 注释: '', 修改人: 'carol', 修改时间: 'T2' }
  ]);
});

test('configList：空结果输出提示，json 输出空数组', async t => {
  seedDev();
  fetchStub(t, () => jsonResponse([]));
  const empty = await withOutput(() => commands.configList('app', {}));
  assert.equal(empty.stdout, '没有配置项\n');

  fetchStub(t, () => jsonResponse(null));
  const json = await withOutput(() => commands.configList('app', { json: true }));
  assert.equal(json.stdout, '[]\n');
});

test('configGet：命中输出单行（json），未命中报错', async t => {
  seedDev();
  fetchStub(t, () => jsonResponse([{ key: 'k', value: 'v', comment: '', dataChangeCreatedBy: 'bob' }]));
  const hit = await withOutput(() => commands.configGet('app', 'k', { json: true }));
  assert.deepEqual(JSON.parse(hit.stdout), [{ key: 'k', value: 'v', 注释: '', 修改人: 'bob', 修改时间: '' }]);

  fetchStub(t, () => jsonResponse([{ key: 'other', value: 'v' }]));
  await assert.rejects(withOutput(() => commands.configGet('app', 'k', {})), /配置项 "k" 不存在/);
});

test('configSet：已存在走更新（PUT + 时间戳/操作人/id）', async t => {
  seedDev();
  const calls = fetchStub(t, record =>
    record.method === 'GET'
      ? jsonResponse([{ id: 7, key: 'k', value: 'old', comment: 'oldc' }])
      : jsonResponse(null)
  );
  const { stdout } = await withOutput(() => commands.configSet('app', 'k', 'newv', {}));
  assert.equal(stdout, '配置项 "k" 已更新\n');
  assert.equal(calls.length, 2, '只应发生 GET + PUT 两次请求');
  assert.equal(calls[1].method, 'PUT');
  const body = JSON.parse(calls[1].body);
  assert.equal(body.id, 7);
  assert.equal(body.key, 'k');
  assert.equal(body.value, 'newv');
  assert.equal(body.comment, 'oldc');
  assert.equal(body.dataChangeLastModifiedBy, 'alice');
  assert.match(body.dataChangeLastModifiedTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Math.abs(Date.now() - Date.parse(body.dataChangeLastModifiedTime)) < 10_000);
});

test('configSet：--comment 覆盖既有注释', async t => {
  seedDev();
  const calls = fetchStub(t, record =>
    record.method === 'GET'
      ? jsonResponse([{ id: 7, key: 'k', value: 'old', comment: 'oldc' }])
      : jsonResponse(null)
  );
  await withOutput(() => commands.configSet('app', 'k', 'newv', { comment: 'newc' }));
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].body).comment, 'newc');
});

test('configSet：不存在走新增（POST + 创建人 + 空注释兜底）', async t => {
  seedDev();
  const calls = fetchStub(t, record => (record.method === 'GET' ? jsonResponse([]) : jsonResponse(null)));
  const { stdout } = await withOutput(() => commands.configSet('app', 'k', 'v', {}));
  assert.equal(stdout, '配置项 "k" 已新增\n');
  assert.equal(calls.length, 3, '空命名空间会多查一次格式，共 GET items + GET namespaces + POST');
  assert.equal(calls[0].method, 'GET');
  assert.equal(
    calls[0].url,
    `${portal}/apps/app/envs/DEV/clusters/default/namespaces/application/items`
  );
  assert.match(calls[1].url, /\/namespaces$/, '第二次请求是命名空间列表（列表返回空 → 按 properties 处理）');
  assert.equal(calls[2].method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].body), { key: 'k', value: 'v', comment: '', dataChangeCreatedBy: 'alice' });
});

test('configSet：--namespace/--cluster 透传进 URL', async t => {
  seedDev();
  const calls = fetchStub(t, () => jsonResponse([]));
  await withOutput(() =>
    commands.configSet('app', 'k', 'v', { namespace: 'custom.ns', cluster: 'c2' })
  );
  assert.equal(
    calls[0].url,
    `${portal}/apps/app/envs/DEV/clusters/c2/namespaces/custom.ns/items`
  );
  assert.equal(
    calls[1].url,
    `${portal}/apps/app/envs/DEV/clusters/c2/namespaces`
  );
  assert.equal(calls.length, 3);
});

test('configRm：未命中报错', async t => {
  seedDev();
  fetchStub(t, () => jsonResponse([{ key: 'other', value: 'v' }]));
  await assert.rejects(withOutput(() => commands.configRm('app', 'k', { yes: true })), /配置项 "k" 不存在/);
});

test('configRm：--yes 直接删除并带 operator', async t => {
  seedDev();
  const calls = fetchStub(t, record =>
    record.method === 'GET' ? jsonResponse([{ id: 9, key: 'k', value: 'v' }]) : jsonResponse(null)
  );
  const { stdout } = await withOutput(() => commands.configRm('app', 'k', { yes: true }));
  assert.equal(stdout, '配置项 "k" 已删除\n');
  assert.equal(calls.length, 2, '只应发生 GET + DELETE 两次请求');
  assert.equal(calls[1].method, 'DELETE');
  assert.equal(
    calls[1].url,
    `${portal}/apps/app/envs/DEV/clusters/default/namespaces/application/items/9?operator=alice`
  );
});

test('configRm：session 无 username 时 operator 为空', async t => {
  seedDev({ session: { baseUrl: portal, cookie: 'c' } });
  const calls = fetchStub(t, record =>
    record.method === 'GET' ? jsonResponse([{ id: 9, key: 'k', value: 'v' }]) : jsonResponse(null)
  );
  await withOutput(() => commands.configRm('app', 'k', { yes: true }));
  assert.match(calls[1].url, /\?operator=$/);
  assert.equal(calls.length, 2);
});

test('configPublish：默认标题格式与 body 映射', async t => {
  seedDev();
  const calls = fetchStub(t, () => jsonResponse({ id: 42 }));
  const { stdout } = await withOutput(() => commands.configPublish('app', {}));
  assert.equal(stdout, '发布成功 (releaseId: 42)\n');
  const body = JSON.parse(calls[0].body);
  assert.match(body.releaseTitle, /^apollo-cli 发布 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(body.releaseComment, '');
  assert.equal(body.releasedBy, 'alice');
  assert.equal(body.emergencyPublish, false);
});

test('configPublish：显式 title/comment/emergency 覆盖并输出标题', async t => {
  seedDev();
  const calls = fetchStub(t, () => jsonResponse({ id: 42, releaseTitle: 'v1' }));
  const { stdout } = await withOutput(() =>
    commands.configPublish('app', { title: 'v1', comment: 'c', emergency: true })
  );
  assert.equal(stdout, '发布成功 (releaseId: 42, title: v1)\n');
  const body = JSON.parse(calls[0].body);
  assert.equal(body.releaseTitle, 'v1');
  assert.equal(body.releaseComment, 'c');
  assert.equal(body.emergencyPublish, true);
});

test('configPublish：空响应仅输出发布成功', async t => {
  seedDev();
  fetchStub(t, () => emptyResponse(200));
  const { stdout } = await withOutput(() => commands.configPublish('app', {}));
  assert.equal(stdout, '发布成功\n');
});

test('configReleases：数组响应的字段回退与 limit 进 URL', async t => {
  seedDev();
  const calls = fetchStub(t, () =>
    jsonResponse([
      { releaseId: 1, releaseTitle: 't', operator: 'bob', releaseTime: 'T', releaseComment: 'c' },
      { id: 2, releasedBy: 'x', dataChangeCreatedTime: 'T2' }
    ])
  );
  const { stdout } = await withOutput(() => commands.configReleases('app', { limit: 5, json: true }));
  assert.match(calls[0].url, /\/releases\/histories\?page=0&size=5$/);
  assert.deepEqual(JSON.parse(stdout), [
    { id: 1, 标题: 't', 发布人: 'bob', 时间: 'T', 说明: 'c' },
    { id: 2, 标题: '', 发布人: 'x', 时间: 'T2', 说明: '' }
  ]);
});

test('configReleases：page 包装响应取 content，默认 limit 为 10', async t => {
  seedDev();
  const calls = fetchStub(t, () => jsonResponse({ content: [{ releaseId: 3 }] }));
  const { stdout } = await withOutput(() => commands.configReleases('app', { json: true }));
  assert.match(calls[0].url, /size=10$/);
  assert.deepEqual(JSON.parse(stdout), [{ id: 3, 标题: '', 发布人: '', 时间: '', 说明: '' }]);
});

test('configReleases：空结果输出提示', async t => {
  seedDev();
  fetchStub(t, () => jsonResponse({ content: [] }));
  const { stdout } = await withOutput(() => commands.configReleases('app', {}));
  assert.equal(stdout, '没有发布记录\n');
});

// ---- config（文件型命名空间字段级） ----

test('configGet：文件型命名空间读标量并多查一次格式', async t => {
  seedDev();
  const calls = fetchStub(
    t,
    fileNsHandler({ format: 'yml', items: [{ key: 'content', value: 'a: 1\nb: 2\n' }] })
  );
  const { stdout } = await withOutput(() => commands.configGet('app', 'a', {}));
  assert.equal(stdout, '1\n');
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/namespaces$/);
});

test('configGet：嵌套与数组取值、--json 形态', async t => {
  seedDev();
  fetchStub(t, fileNsHandler({ format: 'yml', items: [{ key: 'content', value: 'a:\n  b: [x, y]\n' }] }));
  const el = await withOutput(() => commands.configGet('app', 'a.b[1]', {}));
  assert.equal(el.stdout, 'y\n');
  const seg = await withOutput(() => commands.configGet('app', 'a', {}));
  assert.equal(seg.stdout, 'b:\n  - x\n  - y\n');
  const json = await withOutput(() => commands.configGet('app', 'a.b[1]', { json: true }));
  assert.equal(json.stdout, '"y"\n');
});

test('configGet：文件型错误分支（未命中/content 未创建/解析失败/途中标量）', async t => {
  seedDev();
  fetchStub(t, fileNsHandler({ format: 'yml', items: [{ key: 'content', value: 'a: 1\n' }] }));
  await assert.rejects(withOutput(() => commands.configGet('app', 'ghost', {})), /字段 "ghost" 不存在/);

  fetchStub(t, fileNsHandler({ format: 'yaml', items: [] }));
  await assert.rejects(
    withOutput(() => commands.configGet('app', 'a', {})),
    /字段 "a" 不存在（配置项 "content" 尚未创建）/
  );

  fetchStub(t, fileNsHandler({ format: 'yml', items: [{ key: 'content', value: 'a: [1,\n' }] }));
  await assert.rejects(withOutput(() => commands.configGet('app', 'a', {})), /内容解析失败（格式 yml）/);

  fetchStub(t, fileNsHandler({ format: 'yml', items: [{ key: 'content', value: 'a: 1\n' }] }));
  await assert.rejects(withOutput(() => commands.configGet('app', 'a.b', {})), /不是对象或数组/);
});

test('configSet：文件型只改目标字段并保留注释', async t => {
  seedDev();
  const calls = fetchStub(
    t,
    fileNsHandler({
      format: 'yml',
      items: [{ id: 7, key: 'content', value: 'a: 1 # keep\nb: 2\n', comment: 'oldc' }]
    })
  );
  const { stdout } = await withOutput(() => commands.configSet('app', 'a', '9', {}));
  assert.equal(stdout, '字段 "a" 已更新\n');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].method, 'PUT');
  const body = JSON.parse(calls[2].body);
  assert.equal(body.id, 7);
  assert.equal(body.key, 'content');
  assert.equal(body.value, 'a: 9 # keep\nb: 2\n');
  assert.equal(body.comment, 'oldc');
  assert.equal(body.dataChangeLastModifiedBy, 'alice');
  assert.match(body.dataChangeLastModifiedTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('configSet：文件型字段不存在时文案为已新增', async t => {
  seedDev();
  fetchStub(t, fileNsHandler({ format: 'yml', items: [{ id: 1, key: 'content', value: 'a: 1\n' }] }));
  const { stdout } = await withOutput(() => commands.configSet('app', 'b.c', '2', {}));
  assert.equal(stdout, '字段 "b.c" 已新增\n');
});

test('configSet：文件型类型解析与 --string', async t => {
  seedDev();
  const putValue = async (value, opts = {}) => {
    const calls = fetchStub(
      t,
      fileNsHandler({ format: 'yml', items: [{ id: 1, key: 'content', value: 'a: 0\n' }] })
    );
    await withOutput(() => commands.configSet('app', 'a', value, opts));
    return JSON.parse(calls[2].body).value;
  };
  assert.equal(await putValue('123'), 'a: 123\n');
  assert.equal(await putValue('true'), 'a: true\n');
  assert.equal(await putValue('null'), 'a: null\n');
  assert.equal(await putValue('{}'), 'a: {}\n');
  assert.equal(await putValue('123', { string: true }), 'a: "123"\n');
  assert.equal(await putValue('{a: 1}'), 'a:\n  a: 1\n');
});

test('configSet：json 命名空间紧凑内容与结尾换行保持原样', async t => {
  seedDev();
  const calls = fetchStub(
    t,
    fileNsHandler({ format: 'json', items: [{ id: 3, key: 'content', value: '{"a":1}\n' }] })
  );
  await withOutput(() => commands.configSet('app', 'a', '2', {}));
  assert.equal(JSON.parse(calls[2].body).value, '{"a":2}\n');
});

test('configSet：文件型空命名空间创建 content 条目', async t => {
  seedDev();
  const calls = fetchStub(t, fileNsHandler({ format: 'yaml', items: [] }));
  const { stdout } = await withOutput(() => commands.configSet('app', 'a.b', '1', {}));
  assert.equal(stdout, '字段 "a.b" 已新增（已创建配置项 "content"）\n');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].body), {
    key: 'content',
    value: 'a:\n  b: 1\n',
    comment: '',
    dataChangeCreatedBy: 'alice'
  });
});

test('configSet：properties 单个 content 键不被劫持', async t => {
  seedDev();
  const propsHandler = record => {
    if (record.url.endsWith('/namespaces')) {
      return jsonResponse([{ baseInfo: { namespaceName: 'application' }, format: 'properties' }]);
    }
    if (record.method === 'GET') return jsonResponse([{ id: 5, key: 'content', value: 'plain', comment: '' }]);
    return jsonResponse(null);
  };
  const calls = fetchStub(t, propsHandler);
  const updated = await withOutput(() => commands.configSet('app', 'content', '123', {}));
  assert.equal(updated.stdout, '配置项 "content" 已更新\n');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].method, 'PUT');
  assert.equal(JSON.parse(calls[2].body).value, '123', 'properties 值不做 YAML 解析');

  const calls2 = fetchStub(t, propsHandler);
  const created = await withOutput(() => commands.configSet('app', 'a.b', 'v', {}));
  assert.equal(created.stdout, '配置项 "a.b" 已新增\n');
  assert.equal(calls2.length, 3);
  assert.equal(calls2[2].method, 'POST');
  assert.equal(JSON.parse(calls2[2].body).key, 'a.b');
});

test('configGet：properties 单个 content 键仍按旧行为输出', async t => {
  seedDev();
  const calls = fetchStub(t, record => {
    if (record.url.endsWith('/namespaces')) {
      return jsonResponse([{ baseInfo: { namespaceName: 'application' }, format: 'properties' }]);
    }
    if (record.method === 'GET') {
      return jsonResponse([{ id: 5, key: 'content', value: 'plain', comment: 'c1', dataChangeCreatedBy: 'bob' }]);
    }
    return jsonResponse(null);
  });
  const { stdout } = await withOutput(() => commands.configGet('app', 'content', { json: true }));
  assert.deepEqual(JSON.parse(stdout), [
    { key: 'content', value: 'plain', 注释: 'c1', 修改人: 'bob', 修改时间: '' }
  ]);
  assert.equal(calls.length, 2);
});

test('configSet：非歧义场景不产生格式查询请求', async t => {
  seedDev();
  const calls = fetchStub(t, record =>
    record.method === 'GET' ? jsonResponse([{ id: 1, key: 'k', value: 'old' }]) : jsonResponse(null)
  );
  await withOutput(() => commands.configSet('app', 'k', 'v', {}));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => !c.url.endsWith('/namespaces')), '不应查询命名空间列表');
});

test('configSet：格式消歧查询失败时报错且不写入', async t => {
  seedDev();
  const calls = fetchStub(t, record => {
    if (record.url.endsWith('/namespaces')) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    return jsonResponse([]);
  });
  await assert.rejects(withOutput(() => commands.configSet('app', 'k', 'v', {})), /无法连接/);
  assert.equal(calls.length, 2, '只应发生 GET items + 失败的 GET namespaces');
});

test('configSet：文件型 --namespace/--cluster 三段 URL', async t => {
  seedDev();
  const calls = fetchStub(
    t,
    fileNsHandler({ format: 'yml', namespace: 'app.yml', items: [{ id: 9, key: 'content', value: 'a: 1\n' }] })
  );
  await withOutput(() => commands.configSet('app', 'a', '2', { namespace: 'app.yml', cluster: 'c2' }));
  assert.equal(calls[0].url, `${portal}/apps/app/envs/DEV/clusters/c2/namespaces/app.yml/items`);
  assert.equal(calls[1].url, `${portal}/apps/app/envs/DEV/clusters/c2/namespaces`);
  assert.equal(calls[2].url, `${portal}/apps/app/envs/DEV/clusters/c2/namespaces/app.yml/item`);
  assert.equal(calls[2].method, 'PUT');
});

test('configSet：文件型路径无效与值解析失败', async t => {
  seedDev();
  const calls = fetchStub(t, fileNsHandler({ format: 'yml', items: [{ id: 1, key: 'content', value: 'a: 1\n' }] }));
  await assert.rejects(withOutput(() => commands.configSet('app', 'a..b', '1', {})), /字段路径无效/);
  assert.equal(calls.length, 2, '校验失败不应发起写请求');

  const calls2 = fetchStub(t, fileNsHandler({ format: 'yml', items: [{ id: 1, key: 'content', value: 'a: 1\n' }] }));
  await assert.rejects(withOutput(() => commands.configSet('app', 'a', '{bad', {})), /值解析失败/);
  assert.equal(calls2.length, 2);
});

// ---- 环境选择 ----

test('APOLLO_ENV 环境变量选择目标环境', async t => {
  seedUserConfig(iso.home, {
    default: 'dev',
    environments: {
      dev: { baseUrl: portal, portalEnv: 'DEV' },
      uat: { baseUrl: 'http://uat.test', portalEnv: 'UAT' }
    }
  });
  seedSession(iso.home, 'dev', { baseUrl: portal, cookie: 'c1' });
  seedSession(iso.home, 'uat', { baseUrl: 'http://uat.test', cookie: 'c2' });
  const restore = setEnv({ APOLLO_ENV: 'uat' });
  try {
    const calls = fetchStub(t, () => jsonResponse([]));
    await withOutput(() => commands.configList('app', { json: true }));
    assert.equal(calls[0].url, 'http://uat.test/apps/app/envs/UAT/clusters/default/namespaces/application/items');
  } finally {
    restore();
  }
});
