import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, rmSync, utimesSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setupIsolatedHome, assertIsolated, withOutput, writeJSONFile, setEnv } from './helpers.js';

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
  assert.deepEqual(store.loadConfig(), { default: null, profiles: {}, env: {} });
});

test('loadConfig：仅用户配置时加载用户配置', () => {
  writeJSONFile(userConfigFile, { default: 'dev', profiles: { dev: { baseUrl: 'http://u' } } });
  assert.deepEqual(store.loadConfig(), { default: 'dev', profiles: { dev: { baseUrl: 'http://u' } }, env: {} });
});

test('loadConfig：项目配置整体覆盖同名 profile 且优先 default', () => {
  writeJSONFile(userConfigFile, {
    default: 'dev',
    profiles: { dev: { baseUrl: 'http://user' }, keep: { baseUrl: 'http://keep' } }
  });
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), {
    default: 'uat',
    profiles: { dev: { baseUrl: 'http://project' }, uat: { baseUrl: 'http://uat' } }
  });
  process.chdir(caseDir);
  assert.deepEqual(store.loadConfig(), {
    default: 'uat',
    profiles: {
      dev: { baseUrl: 'http://project' },
      keep: { baseUrl: 'http://keep' },
      uat: { baseUrl: 'http://uat' }
    },
    env: {}
  });
});

test('loadConfig：env 段按用户→项目合并，项目覆盖同名键', () => {
  writeJSONFile(userConfigFile, {
    profiles: {},
    env: { APOLLO_USERNAME: 'from-user', APOLLO_PROFILE: 'dev' }
  });
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), {
    profiles: {},
    env: { APOLLO_USERNAME: 'from-project' }
  });
  process.chdir(caseDir);
  assert.deepEqual(store.loadConfig().env, { APOLLO_USERNAME: 'from-project', APOLLO_PROFILE: 'dev' });
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

// ---- getEnvVar ----

test('getEnvVar：process.env 优先于 config.json env 段', () => {
  writeJSONFile(userConfigFile, { profiles: {}, env: { APOLLO_PROFILE: 'from-cfg' } });
  const restore = setEnv({ APOLLO_PROFILE: 'from-env' });
  try {
    assert.equal(store.getEnvVar('APOLLO_PROFILE'), 'from-env');
  } finally {
    restore();
  }
});

test('getEnvVar：环境变量缺失时回退 config.json env 段，都没有返回 null', () => {
  writeJSONFile(userConfigFile, { profiles: {}, env: { APOLLO_PROFILE: 'from-cfg' } });
  assert.equal(store.getEnvVar('APOLLO_PROFILE'), 'from-cfg');
  assert.equal(store.getEnvVar('APOLLO_MISSING'), null);
});

// ---- resolveProfile ----

test('resolveProfile：显式 profile 命中返回配置与上下文', () => {
  writeJSONFile(userConfigFile, { profiles: { dev: { baseUrl: 'http://d' } } });
  const result = store.resolveProfile('dev');
  assert.equal(result.profileName, 'dev');
  assert.deepEqual(result.config, { baseUrl: 'http://d' });
  assert.deepEqual(result.configFile, { default: null, profiles: { dev: { baseUrl: 'http://d' } }, env: {} });
});

test('resolveProfile：显式 profile 未配置时报错并列出可用 profile', () => {
  writeJSONFile(userConfigFile, { profiles: { dev: {}, uat: {} } });
  assert.throws(() => store.resolveProfile('fat'), /profile "fat" 未配置。可用: dev, uat/);
});

test('resolveProfile：无 profile 时报错并给出添加指引', () => {
  assert.throws(
    () => store.resolveProfile(null),
    err => err.message.includes('未配置任何 profile。请先运行 "apollo-cli setup <环境名>" 完成初始配置')
  );
  // 显式名称在空配置下同样报"未配置"，可用列表为空
  assert.throws(() => store.resolveProfile('fat'), /profile "fat" 未配置。可用: $/);
});

test('resolveProfile：无参时取 default', () => {
  writeJSONFile(userConfigFile, { default: 'uat', profiles: { dev: { n: 1 }, uat: { n: 2 } } });
  assert.equal(store.resolveProfile(null).profileName, 'uat');
});

test('resolveProfile：default 指向不存在的 profile 时报错', () => {
  writeJSONFile(userConfigFile, { default: 'ghost', profiles: { dev: {} } });
  assert.throws(() => store.resolveProfile(null), /默认 profile "ghost" 不存在/);
});

test('resolveProfile：无 default 时取第一个 profile（插入序）', () => {
  writeJSONFile(userConfigFile, { profiles: { uat: { n: 2 }, dev: { n: 1 } } });
  assert.equal(store.resolveProfile(null).profileName, 'uat');
});

// ---- getAllProfiles / saveUserConfig ----

test('getAllProfiles：返回合并后的 profile 与默认值', () => {
  writeJSONFile(userConfigFile, { default: 'dev', profiles: { dev: { baseUrl: 'http://u' } } });
  assert.deepEqual(store.getAllProfiles(), { profiles: { dev: { baseUrl: 'http://u' } }, default: 'dev' });
});

test('saveUserConfig：首次写入自动建目录且不产生 default 键', () => {
  const envData = { baseUrl: 'http://p', portalEnv: 'DEV', cluster: 'default' };
  store.saveUserConfig({ profiles: { dev: envData } });
  // data.default === undefined 且无既有文件 → default 为 undefined，序列化时被省略
  assert.equal(readFileSync(userConfigFile, 'utf8'), JSON.stringify({ profiles: { dev: envData } }, null, 2) + '\n');
  assert.equal(existsSync(join(userDir, `config.json.${process.pid}.tmp`)), false);
});

test('saveUserConfig：同名 profile 按字段合并并覆盖同名键', () => {
  writeJSONFile(userConfigFile, {
    default: 'dev',
    profiles: { dev: { baseUrl: 'http://a' }, old: { baseUrl: 'http://o' } }
  });
  store.saveUserConfig({ profiles: { dev: { baseUrl: 'http://b' }, uat: { baseUrl: 'http://u' } } });
  assert.deepEqual(readJSON(userConfigFile), {
    default: 'dev',
    profiles: {
      dev: { baseUrl: 'http://b' },
      old: { baseUrl: 'http://o' },
      uat: { baseUrl: 'http://u' }
    }
  });
});

test('saveUserConfig：保留用户手写的 env 段', () => {
  writeJSONFile(userConfigFile, {
    profiles: { dev: { baseUrl: 'http://a' } },
    env: { APOLLO_PROFILE: 'dev' }
  });
  store.saveUserConfig({ profiles: { uat: { baseUrl: 'http://u' } } });
  assert.deepEqual(readJSON(userConfigFile).env, { APOLLO_PROFILE: 'dev' });
});

test('saveUserConfig：传入 env 时按变量名合并', () => {
  writeJSONFile(userConfigFile, {
    profiles: {},
    env: { APOLLO_FAT_USERNAME: 'old', KEEP: '1' }
  });
  store.saveUserConfig({ profiles: {}, env: { APOLLO_FAT_USERNAME: 'new', APOLLO_FAT_PASSWORD: 'p' } });
  assert.deepEqual(readJSON(userConfigFile).env, { APOLLO_FAT_USERNAME: 'new', KEEP: '1', APOLLO_FAT_PASSWORD: 'p' });
});

test('saveUserConfig：env 段被手写为非对象时按空对象兜底', () => {
  writeJSONFile(userConfigFile, { profiles: {}, env: 'oops' });
  store.saveUserConfig({ profiles: {}, env: { A: '1' } });
  assert.deepEqual(readJSON(userConfigFile).env, { A: '1' });
});

test('userConfigPath：返回用户级配置文件绝对路径', () => {
  assert.equal(store.userConfigPath(), userConfigFile);
});

test('saveUserConfig：同名 profile 按字段合并，保留手写凭据与额外顶层键', () => {
  writeJSONFile(userConfigFile, {
    name: 'my-project',
    profiles: { dev: { baseUrl: 'http://a', username: 'u', password: 'p' } }
  });
  store.saveUserConfig({ profiles: { dev: { baseUrl: 'http://b', portalEnv: 'DEV', cluster: 'default' } } });
  const written = readJSON(userConfigFile);
  assert.deepEqual(written.profiles.dev, {
    baseUrl: 'http://b',
    portalEnv: 'DEV',
    cluster: 'default',
    username: 'u',
    password: 'p'
  });
  assert.equal(written.name, 'my-project');
});

test('saveUserConfig：省略 profiles 时仅更新 default，不抛错', () => {
  store.saveUserConfig({ profiles: { dev: { baseUrl: 'http://d' } } });
  store.saveUserConfig({ default: 'dev' });
  const written = readJSON(userConfigFile);
  assert.equal(written.default, 'dev');
  assert.deepEqual(written.profiles, { dev: { baseUrl: 'http://d' } });
});

test('saveUserConfig：default 传 null 可置空，不传则保留', () => {
  store.saveUserConfig({ default: null, profiles: {} });
  assert.equal(readJSON(userConfigFile).default, null);
  store.saveUserConfig({ profiles: {} });
  assert.equal(readJSON(userConfigFile).default, null);

  writeJSONFile(userConfigFile, { default: 'dev', profiles: {} });
  store.saveUserConfig({ profiles: {} });
  assert.equal(readJSON(userConfigFile).default, 'dev');
});

// ---- removeProfile / setDefaultProfile ----

test('removeProfile：仅用户配置命中时返回用户 scope 并置空 default', () => {
  writeJSONFile(userConfigFile, {
    default: 'dev',
    profiles: { dev: { baseUrl: 'http://d' }, uat: { baseUrl: 'http://u' } }
  });
  assert.deepEqual(store.removeProfile('dev'), ['用户配置']);
  assert.deepEqual(readJSON(userConfigFile), { default: null, profiles: { uat: { baseUrl: 'http://u' } } });
});

test('removeProfile：仅项目配置命中时返回项目 scope', () => {
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), { profiles: { dev: { baseUrl: 'http://p' } } });
  process.chdir(caseDir);
  assert.deepEqual(store.removeProfile('dev'), ['项目配置']);
  assert.deepEqual(readJSON(join(caseDir, 'apollo-cli.config.json')), { profiles: {} });
  assert.equal(existsSync(userConfigFile), false);
});

test('removeProfile：两处命中时按用户、项目顺序返回', () => {
  writeJSONFile(userConfigFile, { default: 'dev', profiles: { dev: {} } });
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), { default: 'dev', profiles: { dev: {} } });
  process.chdir(caseDir);
  assert.deepEqual(store.removeProfile('dev'), ['用户配置', '项目配置']);
  assert.deepEqual(readJSON(userConfigFile), { default: null, profiles: {} });
  assert.deepEqual(readJSON(join(caseDir, 'apollo-cli.config.json')), { default: null, profiles: {} });
});

test('removeProfile：都不存在时返回空数组', () => {
  assert.deepEqual(store.removeProfile('ghost'), []);
});

test('removeProfile：写回项目文件时保留额外顶层键', () => {
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), {
    name: 'my-project',
    default: 'dev',
    profiles: { dev: {} }
  });
  process.chdir(caseDir);
  store.removeProfile('dev');
  assert.deepEqual(readJSON(join(caseDir, 'apollo-cli.config.json')), {
    name: 'my-project',
    default: null,
    profiles: {}
  });
});

test('setDefaultProfile：项目已声明 default 时写项目', () => {
  const caseDir = iso.caseDir();
  const projectFile = join(caseDir, 'apollo-cli.config.json');
  writeJSONFile(projectFile, { default: 'dev', profiles: {} });
  process.chdir(caseDir);
  const result = store.setDefaultProfile('uat');
  assert.equal(resolve(result.path), resolve(projectFile));
  assert.equal(result.scope, '项目配置');
  assert.equal(readJSON(projectFile).default, 'uat');
  assert.equal(existsSync(userConfigFile), false);
});

test('setDefaultProfile：项目存在但无 default 时写用户配置', () => {
  const caseDir = iso.caseDir();
  writeJSONFile(join(caseDir, 'apollo-cli.config.json'), { profiles: {} });
  process.chdir(caseDir);
  const result = store.setDefaultProfile('uat');
  assert.equal(result.scope, '用户配置');
  assert.equal(resolve(result.path), resolve(userConfigFile));
  assert.deepEqual(readJSON(userConfigFile), { profiles: {}, default: 'uat' });
});

test('setDefaultProfile：无项目配置时写用户配置', () => {
  const result = store.setDefaultProfile('uat');
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

test('saveSession：多 profile 并存互不覆盖', () => {
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

test('clearSession：只清除目标 profile', () => {
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
