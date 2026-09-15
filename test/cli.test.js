import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupIsolatedHome,
  assertIsolated,
  withOutput,
  fetchStub,
  jsonResponse,
  redirectResponse,
  seedUserConfig,
  seedSession,
  fileNsHandler
} from './helpers.js';

const iso = setupIsolatedHome();
const { run } = await import('../src/cli.js');
assertIsolated(iso);

const portal = 'http://portal.test';
const userConfigFile = join(iso.home, '.apollo-cli', 'config.json');

function readJSON(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function seedDev() {
  seedUserConfig(iso.home, {
    default: 'dev',
    environments: { dev: { baseUrl: portal, portalEnv: 'DEV', cluster: 'default' } }
  });
  seedSession(iso.home, 'dev', { baseUrl: portal, cookie: 'sess-cookie', username: 'alice', savedAt: 1 });
}

async function runCli(args) {
  const origArgv = process.argv;
  const origExitCode = process.exitCode;
  process.argv = ['node', 'apollo-cli', ...args];
  try {
    const { stdout, stderr } = await withOutput(() => run());
    return { stdout, stderr, exitCode: process.exitCode };
  } finally {
    process.argv = origArgv;
    process.exitCode = origExitCode;
  }
}

beforeEach(() => {
  process.chdir(iso.home);
  rmSync(join(iso.home, '.apollo-cli'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(join(iso.home, 'apollo-cli.config.json'), { force: true });
  rmSync(join(iso.home, '.env'), { force: true });
});

after(() => iso.cleanup());

test('cli：无参与 --help/-h 输出帮助且不置 exitCode', async () => {
  for (const args of [[], ['--help'], ['-h']]) {
    const res = await runCli(args);
    assert.match(res.stdout, /^apollo-cli — Apollo 配置中心命令行工具\n/);
    assert.match(res.stdout, /用法:/);
    assert.equal(res.exitCode, undefined, `args=${args.join(' ')} 不应设置 exitCode`);
    assert.equal(res.stderr, '');
  }
});

test('cli：未知命令报错并置 exitCode=1', async () => {
  const res = await runCli(['foo']);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '未知命令: "foo"\n可用命令: login, logout, env, ns, config\n');
  assert.equal(res.exitCode, 1);
});

test('cli：env 无参输出子帮助，未知子命令报错', async () => {
  const help = await runCli(['env']);
  assert.match(help.stdout, /用法:\n  apollo-cli env list/);
  assert.equal(help.exitCode, undefined);

  const bad = await runCli(['env', 'x']);
  assert.equal(bad.stderr, '未知 env 子命令: "x"。可用: list, add, rm, default\n');
  assert.equal(bad.exitCode, 1);
});

test('cli：env add 缺参数校验', async () => {
  const missingName = await runCli(['env', 'add']);
  assert.equal(missingName.stderr, '缺少参数。用法: env add <name> --base-url <url>\n');
  assert.equal(missingName.exitCode, 1);

  const missingUrl = await runCli(['env', 'add', 'dev']);
  assert.equal(missingUrl.stderr, '--base-url 是必填参数\n');
  assert.equal(missingUrl.exitCode, 1);
});

test('cli：env add 全链路落盘并支持 --default', async () => {
  const res = await runCli(['env', 'add', 'dev', '--base-url', 'http://p', '--default']);
  assert.match(
    res.stdout,
    /^环境 "dev" 已添加 \(portal: DEV, cluster: default\)\n默认环境已设为 "dev"（已写入用户配置: .*config\.json）\n$/
  );
  assert.equal(res.exitCode, undefined);
  assert.deepEqual(readJSON(userConfigFile), {
    environments: { dev: { baseUrl: 'http://p', portalEnv: 'DEV', cluster: 'default' } },
    default: 'dev'
  });
});

test('cli：env list --json 输出可解析 JSON', async () => {
  const res = await runCli(['env', 'list', '--json']);
  assert.equal(res.stdout, '[]\n');
  assert.deepEqual(JSON.parse(res.stdout), []);
});

test('cli：ns 子命令帮助与缺参', async () => {
  const help = await runCli(['ns']);
  assert.equal(help.stdout, '用法: apollo-cli ns ls <appId>\n');

  const bad = await runCli(['ns', 'x']);
  assert.equal(bad.stderr, '未知 ns 子命令。可用: ls\n');
  assert.equal(bad.exitCode, 1);

  const missing = await runCli(['ns', 'ls']);
  assert.equal(missing.stderr, '缺少参数。用法: ns ls <appId>\n');
  assert.equal(missing.exitCode, 1);
});

test('cli：ns ls 成功走通（fetch 桩）', async t => {
  seedDev();
  const calls = fetchStub(t, () =>
    jsonResponse([{ baseInfo: { namespaceName: 'application' }, items: [{ key: 'a' }, { key: 'b' }] }])
  );
  const res = await runCli(['ns', 'ls', 'MyApp', '--json']);
  assert.equal(calls[0].url, `${portal}/apps/MyApp/envs/DEV/clusters/default/namespaces`);
  assert.deepEqual(JSON.parse(res.stdout), [
    { appId: 'MyApp', 命名空间: 'application', 格式: 'properties', 类型: '私有', 配置数: 2 }
  ]);
  assert.equal(res.exitCode, undefined);
});

test('cli：config 帮助与未知子命令', async () => {
  const help = await runCli(['config']);
  assert.match(help.stdout, /用法:\n  apollo-cli config ls <appId>/);

  const bad = await runCli(['config', 'x']);
  assert.equal(bad.stderr, '未知 config 子命令: "x"。可用: ls, get, set, rm, publish, releases\n');
  assert.equal(bad.exitCode, 1);
});

test('cli：config 各子命令缺参校验', async () => {
  const cases = [
    [['config', 'ls'], '缺少参数。用法: config ls <appId>'],
    [['config', 'get', 'app'], '缺少参数。用法: config get <appId> <key>'],
    [['config', 'set', 'app', 'k'], '缺少参数。用法: config set <appId> <key> <value>'],
    [['config', 'rm', 'app'], '缺少参数。用法: config rm <appId> <key>'],
    [['config', 'publish'], '缺少参数。用法: config publish <appId>'],
    [['config', 'releases'], '缺少参数。用法: config releases <appId>']
  ];
  for (const [args, message] of cases) {
    const res = await runCli(args);
    assert.equal(res.stderr, message + '\n', `args=${args.join(' ')}`);
    assert.equal(res.exitCode, 1);
  }
});

test('cli：--limit 必须是正整数', async () => {
  const zero = await runCli(['config', 'releases', 'app', '--limit', '0']);
  assert.equal(zero.stderr, '--limit 必须是正整数（收到 "0"）\n');
  assert.equal(zero.exitCode, 1);

  const nan = await runCli(['config', 'releases', 'app', '--limit', 'abc']);
  assert.equal(nan.stderr, '--limit 必须是正整数（收到 "abc"）\n');
  assert.equal(nan.exitCode, 1);
});

test('cli：未知选项报错（只锁 --bogus 与退出码，英文文案随 Node 版本可变）', async () => {
  const res = await runCli(['env', 'list', '--bogus']);
  assert.match(res.stderr, /--bogus/);
  assert.notEqual(res.stderr, '');
  assert.equal(res.exitCode, 1);
});

test('cli：-e/-n 透传到目标环境与命名空间', async t => {
  seedUserConfig(iso.home, {
    default: 'dev',
    environments: {
      dev: { baseUrl: portal, portalEnv: 'DEV' },
      uat: { baseUrl: 'http://uat.test', portalEnv: 'UAT' }
    }
  });
  seedSession(iso.home, 'uat', { baseUrl: 'http://uat.test', cookie: 'c2', username: 'alice', savedAt: 1 });
  const calls = fetchStub(t, () => jsonResponse([{ key: 'k', value: 'v' }]));
  const res = await runCli(['config', 'get', 'app', 'k', '-e', 'uat', '-n', 'custom.ns', '--json']);
  assert.equal(
    calls[0].url,
    'http://uat.test/apps/app/envs/UAT/clusters/default/namespaces/custom.ns/items'
  );
  assert.deepEqual(JSON.parse(res.stdout), [{ key: 'k', value: 'v', 注释: '', 修改人: '', 修改时间: '' }]);
});

test('cli：config get 文件型字段透传并输出标量', async t => {
  seedDev();
  const calls = fetchStub(
    t,
    fileNsHandler({ format: 'yml', namespace: 'app.yml', items: [{ key: 'content', value: 'a: 1\n' }] })
  );
  const res = await runCli(['config', 'get', 'app', 'a', '-n', 'app.yml']);
  assert.equal(res.stdout, '1\n');
  assert.equal(res.exitCode, undefined);
  assert.match(calls[0].url, /\/namespaces\/app\.yml\/items$/);
  assert.match(calls[1].url, /\/namespaces$/);
});

test('cli：config set --string 强制字符串写入且不影响缺参校验', async t => {
  seedDev();
  const calls = fetchStub(
    t,
    fileNsHandler({ format: 'yml', items: [{ id: 1, key: 'content', value: 'a: 0\n' }] })
  );
  const res = await runCli(['config', 'set', 'app', 'a', '123', '--string']);
  assert.equal(res.stdout, '字段 "a" 已更新\n');
  assert.equal(res.exitCode, undefined);
  assert.equal(JSON.parse(calls[2].body).value, 'a: "123"\n');

  const missing = await runCli(['config', 'set', 'app', 'k', '--string']);
  assert.equal(missing.stderr, '缺少参数。用法: config set <appId> <key> <value>\n');
  assert.equal(missing.exitCode, 1);
});

test('cli：config 帮助含字段路径措辞与 --string', async () => {
  const help = await runCli(['config']);
  assert.match(help.stdout, /config get <appId> <key\|path>/);
  assert.match(help.stdout, /config set <appId> <key\|path> <value>/);
  assert.match(help.stdout, /--string/);
});

test('cli：config get 未命中时 exitCode=1', async t => {
  seedDev();
  fetchStub(t, () => jsonResponse([{ key: 'other', value: 'v' }]));
  const res = await runCli(['config', 'get', 'app', 'k']);
  assert.equal(res.stderr, '配置项 "k" 不存在\n');
  assert.equal(res.exitCode, 1);
});

test('cli：login 无环境时报未配置环境', async () => {
  const res = await runCli(['login']);
  assert.match(res.stderr, /未配置任何环境/);
  assert.equal(res.exitCode, 1);
});

test('cli：login --username/--password 成功后落盘 session', async t => {
  seedDev();
  fetchStub(t, (record, idx) =>
    idx === 0 ? redirectResponse('/apps', ['JSESSIONID=cli']) : jsonResponse([])
  );
  const res = await runCli(['login', 'dev', '--username', 'u', '--password', 'p']);
  assert.equal(res.stdout, '登录成功 (dev: http://portal.test) [u]\n');
  assert.equal(res.exitCode, undefined);
  const session = readJSON(join(iso.home, '.apollo-cli', 'session.json'));
  assert.equal(session.dev.username, 'u');
  assert.equal(session.dev.cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=cli');
});

test('cli：login 有环境但无凭据时报未找到凭据', async () => {
  seedUserConfig(iso.home, {
    default: 'dev',
    environments: { dev: { baseUrl: portal, portalEnv: 'DEV' } }
  });
  const res = await runCli(['login', 'dev']);
  assert.match(res.stderr, /未找到凭据。请设置环境变量 APOLLO_DEV_USERNAME\/PASSWORD/);
  assert.equal(res.exitCode, 1);
});

test('cli：logout 清除登录状态', async () => {
  seedDev();
  const res = await runCli(['logout', 'dev']);
  assert.equal(res.stdout, '已清除 dev 的登录状态\n');
  assert.equal(res.exitCode, undefined);
  assert.deepEqual(readJSON(join(iso.home, '.apollo-cli', 'session.json')), {});
});

test('cli：env rm/env default 缺参校验与路由', async () => {
  const rmMissing = await runCli(['env', 'rm']);
  assert.equal(rmMissing.stderr, '缺少参数。用法: env rm <name>\n');
  assert.equal(rmMissing.exitCode, 1);

  const rmGhost = await runCli(['env', 'rm', 'ghost']);
  assert.equal(rmGhost.stderr, '环境 "ghost" 不存在\n');
  assert.equal(rmGhost.exitCode, 1);

  const defMissing = await runCli(['env', 'default']);
  assert.equal(defMissing.stderr, '缺少参数。用法: env default <name>\n');
  assert.equal(defMissing.exitCode, 1);

  const defGhost = await runCli(['env', 'default', 'ghost']);
  assert.equal(defGhost.stderr, '环境 "ghost" 不存在\n');
  assert.equal(defGhost.exitCode, 1);

  seedDev();
  const defOk = await runCli(['env', 'default', 'dev']);
  assert.match(defOk.stdout, /^默认环境已设为 "dev"（已写入用户配置: .*config\.json）\n$/);
  assert.equal(defOk.exitCode, undefined);

  const rmOk = await runCli(['env', 'rm', 'dev']);
  assert.equal(rmOk.stdout, '环境 "dev" 已删除（从用户配置中移除）\n');
  assert.equal(rmOk.exitCode, undefined);
});

test('cli：错误用例跑完后 process.exitCode 无残留', () => {
  assert.notEqual(process.exitCode, 1);
});
