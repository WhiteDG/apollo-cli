import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, rmSync, utimesSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setupIsolatedHome, assertIsolated, withOutput, writeJSONFile } from './helpers.js';

// store.js 在模块加载期冻结 ~/.apollo-cli 路径，必须先完成隔离再动态 import
const iso = setupIsolatedHome();
const store = await import('../src/store.js');
assertIsolated(iso);

const userDir = join(iso.home, '.apollo-cli');
const userConfigFile = join(userDir, 'config.json');
const sessionFile = join(userDir, 'session.json');

function readJSON(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

beforeEach(() => {
  process.chdir(iso.home);
  rmSync(userDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(join(iso.home, 'apollo-cli.config.json'), { force: true });
});

after(() => iso.cleanup());

// ---- loadConfig ----

test('loadConfig：双缺失返回默认结构', () => {
  assert.deepEqual(store.loadConfig(), { default: null, environments: {} });
});

test('loadConfig：仅用户配置时加载用户配置', () => {
  writeJSONFile(userConfigFile, { default: 'dev', environments: { dev: { baseUrl: 'http://u' } } });
  assert.deepEqual(store.loadConfig(), { default: 'dev', environments: { dev: { baseUrl: 'http://u' } } });
});

test('loadConfig：项目配置整体覆盖同名环境且优先 default', () => {
  writeJSONFile(userConfigFile, {
    default: 'dev',
    environments: { dev: { baseUrl: 'http://user' }, keep: { baseUrl: 'http://keep' } }
  });
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), {
    default: 'uat',
    environments: { dev: { baseUrl: 'http://project' }, uat: { baseUrl: 'http://uat' } }
  });
  process.chdir(caseDir);
  assert.deepEqual(store.loadConfig(), {
    default: 'uat',
    environments: {
      dev: { baseUrl: 'http://project' },
      keep: { baseUrl: 'http://keep' },
      uat: { baseUrl: 'http://uat' }
    }
  });
});

test('loadConfig：用户配置损坏时抛中文错误', () => {
  writeJSONFile(userConfigFile, {});
  writeFileSync(userConfigFile, '{broken', 'utf8');
  assert.throws(
    () => store.loadConfig(),
    err => err.message.includes('配置文件损坏（不是合法 JSON）')
  );
});

test('loadConfig：项目配置损坏时抛中文错误', () => {
  const caseDir = iso.caseDir();
  writeFileSync(join(caseDir, 'apollo-cli.config.json'), 'not json', 'utf8');
  process.chdir(caseDir);
  assert.throws(
    () => store.loadConfig(),
    err => err.message.includes('配置文件损坏（不是合法 JSON）')
  );
});

test('loadConfig：用户配置路径不可读时抛读取失败', () => {
  mkdirSync(userConfigFile, { recursive: true });
  assert.throws(
    () => store.loadConfig(),
    err => err.message.includes('读取配置失败')
  );
});

test('loadConfig：项目配置路径不可读时抛读取失败', () => {
  const caseDir = iso.caseDir();
  mkdirSync(join(caseDir, 'apollo-cli.config.json'), { recursive: true });
  process.chdir(caseDir);
  assert.throws(
    () => store.loadConfig(),
    err => err.message.includes('读取配置失败')
  );
});

// ---- resolveEnv ----

test('resolveEnv：显式环境命中返回配置与上下文', () => {
  writeJSONFile(userConfigFile, { environments: { dev: { baseUrl: 'http://d' } } });
  const result = store.resolveEnv('dev');
  assert.equal(result.envName, 'dev');
  assert.deepEqual(result.config, { baseUrl: 'http://d' });
  assert.deepEqual(result.configFile, { default: null, environments: { dev: { baseUrl: 'http://d' } } });
});

test('resolveEnv：显式环境未配置时报错并列出可用环境', () => {
  writeJSONFile(userConfigFile, { environments: { dev: {}, uat: {} } });
  assert.throws(() => store.resolveEnv('fat'), /环境 "fat" 未配置。可用: dev, uat/);
});

test('resolveEnv：无环境时报错并给出添加指引', () => {
  assert.throws(
    () => store.resolveEnv(null),
    err => err.message.includes('未配置任何环境。请先执行 "apollo-cli env add <name> --base-url <url>"')
  );
  // 显式名称在空配置下同样报"未配置"，可用列表为空
  assert.throws(() => store.resolveEnv('fat'), /环境 "fat" 未配置。可用: $/);
});

test('resolveEnv：无参时取 default', () => {
  writeJSONFile(userConfigFile, { default: 'uat', environments: { dev: { n: 1 }, uat: { n: 2 } } });
  assert.equal(store.resolveEnv(null).envName, 'uat');
});

test('resolveEnv：default 指向不存在的环境时报错', () => {
  writeJSONFile(userConfigFile, { default: 'ghost', environments: { dev: {} } });
  assert.throws(() => store.resolveEnv(null), /默认环境 "ghost" 不存在/);
});

test('resolveEnv：无 default 时取第一个环境（插入序）', () => {
  writeJSONFile(userConfigFile, { environments: { uat: { n: 2 }, dev: { n: 1 } } });
  assert.equal(store.resolveEnv(null).envName, 'uat');
});

// ---- getAllEnvs / saveUserConfig ----

test('getAllEnvs：返回合并后的环境与默认值', () => {
  writeJSONFile(userConfigFile, { default: 'dev', environments: { dev: { baseUrl: 'http://u' } } });
  assert.deepEqual(store.getAllEnvs(), { envs: { dev: { baseUrl: 'http://u' } }, default: 'dev' });
});

test('saveUserConfig：首次写入自动建目录且不产生 default 键', () => {
  const envData = { baseUrl: 'http://p', portalEnv: 'DEV', cluster: 'default' };
  store.saveUserConfig({ environments: { dev: envData } });
  // data.default === undefined 且无既有文件 → default 为 undefined，序列化时被省略
  assert.equal(readFileSync(userConfigFile, 'utf8'), JSON.stringify({ environments: { dev: envData } }, null, 2) + '\n');
  assert.equal(existsSync(join(userDir, `config.json.${process.pid}.tmp`)), false);
});

test('saveUserConfig：浅合并保留既有环境并覆盖同名', () => {
  writeJSONFile(userConfigFile, {
    default: 'dev',
    environments: { dev: { baseUrl: 'http://a' }, old: { baseUrl: 'http://o' } }
  });
  store.saveUserConfig({ environments: { dev: { baseUrl: 'http://b' }, uat: { baseUrl: 'http://u' } } });
  assert.deepEqual(readJSON(userConfigFile), {
    default: 'dev',
    environments: {
      dev: { baseUrl: 'http://b' },
      old: { baseUrl: 'http://o' },
      uat: { baseUrl: 'http://u' }
    }
  });
});

test('saveUserConfig：default 传 null 可置空，不传则保留', () => {
  store.saveUserConfig({ default: null, environments: {} });
  assert.equal(readJSON(userConfigFile).default, null);
  store.saveUserConfig({ environments: {} });
  assert.equal(readJSON(userConfigFile).default, null);

  writeJSONFile(userConfigFile, { default: 'dev', environments: {} });
  store.saveUserConfig({ environments: {} });
  assert.equal(readJSON(userConfigFile).default, 'dev');
});

// ---- removeEnv / setDefaultEnv ----

test('removeEnv：仅用户配置命中时返回用户 scope 并置空 default', () => {
  writeJSONFile(userConfigFile, {
    default: 'dev',
    environments: { dev: { baseUrl: 'http://d' }, uat: { baseUrl: 'http://u' } }
  });
  assert.deepEqual(store.removeEnv('dev'), ['用户配置']);
  assert.deepEqual(readJSON(userConfigFile), { default: null, environments: { uat: { baseUrl: 'http://u' } } });
});

test('removeEnv：仅项目配置命中时返回项目 scope', () => {
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), { environments: { dev: { baseUrl: 'http://p' } } });
  process.chdir(caseDir);
  assert.deepEqual(store.removeEnv('dev'), ['项目配置']);
  assert.deepEqual(readJSON(join(caseDir, 'apollo-cli.config.json')), { environments: {} });
  assert.equal(existsSync(userConfigFile), false);
});

test('removeEnv：两处命中时按用户、项目顺序返回', () => {
  writeJSONFile(userConfigFile, { default: 'dev', environments: { dev: {} } });
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), { default: 'dev', environments: { dev: {} } });
  process.chdir(caseDir);
  assert.deepEqual(store.removeEnv('dev'), ['用户配置', '项目配置']);
  assert.deepEqual(readJSON(userConfigFile), { default: null, environments: {} });
  assert.deepEqual(readJSON(join(caseDir, 'apollo-cli.config.json')), { default: null, environments: {} });
});

test('removeEnv：都不存在时返回空数组', () => {
  assert.deepEqual(store.removeEnv('ghost'), []);
});

test('removeEnv：写回项目文件时保留额外顶层键', () => {
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), {
    name: 'my-project',
    default: 'dev',
    environments: { dev: {} }
  });
  process.chdir(caseDir);
  store.removeEnv('dev');
  assert.deepEqual(readJSON(join(caseDir, 'apollo-cli.config.json')), {
    name: 'my-project',
    default: null,
    environments: {}
  });
});

test('setDefaultEnv：项目已声明 default 时写项目', () => {
  const caseDir = iso.caseDir();
  const projectFile = join(caseDir, 'apollo-cli.config.json');
  writeJSONFile(projectFile, { default: 'dev', environments: {} });
  process.chdir(caseDir);
  const result = store.setDefaultEnv('uat');
  assert.equal(resolve(result.path), resolve(projectFile));
  assert.equal(result.scope, '项目配置');
  assert.equal(readJSON(projectFile).default, 'uat');
  assert.equal(existsSync(userConfigFile), false);
});

test('setDefaultEnv：项目存在但无 default 时写用户配置', () => {
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), { environments: {} });
  process.chdir(caseDir);
  const result = store.setDefaultEnv('uat');
  assert.equal(result.scope, '用户配置');
  assert.equal(resolve(result.path), resolve(userConfigFile));
  assert.deepEqual(readJSON(userConfigFile), { environments: {}, default: 'uat' });
});

test('setDefaultEnv：无项目配置时写用户配置', () => {
  const result = store.setDefaultEnv('uat');
  assert.equal(result.scope, '用户配置');
  assert.equal(resolve(result.path), resolve(userConfigFile));
  assert.equal(readJSON(userConfigFile).default, 'uat');
});

// ---- session ----

test('saveSession：首次写入按格式落盘', () => {
  const data = { baseUrl: 'http://p', cookie: 'JSESSIONID=x', username: 'alice', savedAt: 123 };
  store.saveSession('dev', data);
  assert.equal(readFileSync(sessionFile, 'utf8'), JSON.stringify({ dev: data }, null, 2) + '\n');
});

test('saveSession：多环境并存互不覆盖', () => {
  const d1 = { baseUrl: 'http://d', cookie: 'c1' };
  const d2 = { baseUrl: 'http://u', cookie: 'c2' };
  store.saveSession('dev', d1);
  store.saveSession('uat', d2);
  assert.deepEqual(readJSON(sessionFile), { dev: d1, uat: d2 });
});

test('loadSession：缺失时返回空对象', () => {
  assert.deepEqual(store.loadSession(), {});
});

test('loadSession：损坏 JSON 警告一次并返回空对象', async () => {
  // warnOnce 按路径去重：本用例必须是本文件中第一个对 session.json 触发警告的用例；
  // "无法读取"警告场景在 test/store-warn.test.js（独立进程）中覆盖
  writeJSONFile(sessionFile, {});
  writeFileSync(sessionFile, '{broken', 'utf8');
  const first = await withOutput(() => store.loadSession());
  assert.deepEqual(first.result, {});
  assert.match(first.stderr, /内容损坏，已忽略（将自动重建）/);

  const second = await withOutput(() => store.loadSession());
  assert.deepEqual(second.result, {});
  assert.equal(second.stderr, '');
});

test('clearSession：只清除目标环境', () => {
  store.saveSession('dev', { cookie: 'c1' });
  store.saveSession('uat', { cookie: 'c2' });
  store.clearSession('dev');
  assert.deepEqual(readJSON(sessionFile), { uat: { cookie: 'c2' } });
});

test('clearSession：用户目录不存在且无可清除项时不抛错、不创建文件', () => {
  assert.equal(existsSync(userDir), false);
  assert.doesNotThrow(() => store.clearSession('dev'));
  assert.equal(existsSync(userDir), false);
});

test('saveSession：清理超过 10 分钟的陈旧 tmp，保留新 tmp', () => {
  store.saveSession('dev', { cookie: 'c1' });
  const stale = join(userDir, 'session.json.99999.tmp');
  const fresh = join(userDir, 'session.json.99998.tmp');
  writeFileSync(stale, 'x', 'utf8');
  writeFileSync(fresh, 'x', 'utf8');
  const old = new Date(Date.now() - 20 * 60 * 1000);
  utimesSync(stale, old, old);

  store.saveSession('dev', { cookie: 'c2' });
  assert.equal(existsSync(stale), false, '陈旧 tmp 应被清理');
  assert.equal(existsSync(fresh), true, '新 tmp 应保留');
});

test('saveSession：目标路径被目录占用时 rename 失败，重试后降级仍失败并抛出', () => {
  // 须在"损坏 JSON"用例之后执行：本用例经 saveSession → loadSession 会触发
  // session.json 的 lenient 读取，避免抢占该路径的首次 warnOnce 警告
  // 目录占位使 renameSync(tmp, path) 报 EPERM/EACCES/EBUSY（可重试）；
  // Windows 上先走 2 次 50ms 重试，再降级直写目录报 EISDIR 抛出
  mkdirSync(sessionFile, { recursive: true });
  const started = Date.now();
  assert.throws(() => store.saveSession('dev', { cookie: 'c' }));
  if (process.platform === 'win32') {
    assert.ok(Date.now() - started >= 90, '应执行 2 次 50ms 重试');
  }
});

// ---- helpers 隔离行为 ----

test('helpers：小写 apollo_ 前缀变量在隔离建立时也会被清除（Windows 大小写不敏感）', () => {
  process.env.apollo_lower_probe = 'v';
  const inner = setupIsolatedHome();
  try {
    assert.equal(process.env.apollo_lower_probe, undefined);
  } finally {
    inner.cleanup();
    delete process.env.apollo_lower_probe;
  }
});
