import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupIsolatedHome,
  assertIsolated,
  withOutput,
  fetchStub,
  jsonResponse,
  redirectResponse,
  seedUserConfig,
  seedProjectConfig,
  setEnv,
  setStdinTty
} from './helpers.js';

// store.js 在模块加载期冻结 ~/.apollo-cli 路径，必须先完成隔离再动态 import
const iso = setupIsolatedHome();
const commands = await import('../src/commands.js');
assertIsolated(iso);

const configFile = join(iso.home, '.apollo-cli', 'config.json');
const sessionFile = join(iso.home, '.apollo-cli', 'session.json');

function readJSON(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function okLoginStub(t) {
  fetchStub(t, (record, idx) => (idx === 0 ? redirectResponse('/apps', ['JSESSIONID=cli']) : jsonResponse([])));
}

function fakePrompter(answers) {
  const asked = [];
  const next = question => {
    asked.push(question);
    const value = answers.shift();
    return value === undefined ? null : value;
  };
  return { interactive: true, asked, ask: async q => next(q), askHidden: async q => next(q) };
}

const baseVals = (extra = {}) => ({
  'base-url': 'http://portal.example.com:8070/',
  username: 'alice',
  password: 'p@ss',
  ...extra
});

beforeEach(() => {
  process.chdir(iso.home);
  rmSync(join(iso.home, '.apollo-cli'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(join(iso.home, 'apollo-cli.config.json'), { force: true });
  rmSync(join(iso.home, '.env'), { force: true });
});

after(() => iso.cleanup());

test('setup：flags 全量一步完成（落盘 profile+凭据、session、首次自动默认）', async t => {
  okLoginStub(t);
  const { stdout, stderr } = await withOutput(() => commands.profileSetup('fat', baseVals()));
  const cfg = readJSON(configFile);
  assert.deepEqual(cfg.profiles.fat, { baseUrl: 'http://portal.example.com:8070', portalEnv: 'FAT', cluster: 'default' });
  assert.equal(cfg.env.APOLLO_FAT_USERNAME, 'alice');
  assert.equal(cfg.env.APOLLO_FAT_PASSWORD, 'p@ss');
  assert.equal(cfg.default, 'fat');
  assert.equal(readJSON(sessionFile).fat.cookie, 'NG_TRANSLATE_LANG_KEY=zh-CN; JSESSIONID=cli');
  assert.match(stdout, /profile "fat" 已配置并登录成功/);
  assert.equal(stdout.includes('p@ss'), false, 'stdout 不应包含密码');
  assert.equal(stderr, '');
});

test('setup：--json 输出结构化结果且不含密码', async t => {
  okLoginStub(t);
  const { stdout } = await withOutput(() => commands.profileSetup('fat', baseVals({ json: true })));
  const out = JSON.parse(stdout);
  assert.equal(out.profile, 'fat');
  assert.equal(out.baseUrl, 'http://portal.example.com:8070');
  assert.equal(out.portalEnv, 'FAT');
  assert.equal(out.cluster, 'default');
  assert.equal(out.default, true);
  assert.equal(out.username, 'alice');
  assert.ok(out.configPath.endsWith('config.json'));
  assert.equal('password' in out, false);
});

test('setup：非交互缺参立即报错且不写文件', async () => {
  const prompt = {
    interactive: false,
    ask: async () => { throw new Error('不应调用 ask'); },
    askHidden: async () => { throw new Error('不应调用 askHidden'); }
  };
  await assert.rejects(
    withOutput(() => commands.profileSetup(null, {}, prompt)),
    /非交互环境缺少必要信息：profile 名（位置参数）、--base-url、--username、--password/
  );
  assert.equal(existsSync(configFile), false);
});

test('setup：空密码字符串视同缺失', async () => {
  const prompt = { interactive: false, ask: async () => null, askHidden: async () => null };
  await assert.rejects(
    withOutput(() => commands.profileSetup('fat', baseVals({ password: '' }), prompt)),
    /非交互环境缺少必要信息：--password/
  );
  assert.equal(existsSync(configFile), false);
});

test('setup：真实流非 TTY 下缺参报错不挂起', async () => {
  const restore = setStdinTty(false);
  try {
    await assert.rejects(
      withOutput(() => commands.profileSetup(null, { 'base-url': 'http://p' })),
      /非交互环境缺少必要信息：profile 名（位置参数）、--username、--password/
    );
  } finally {
    restore();
  }
  assert.equal(existsSync(configFile), false);
});

test('setup：交互分支按序询问、空输入重问、密码走隐藏提问', async t => {
  okLoginStub(t);
  const prompt = fakePrompter(['', 'fat', 'http://portal.example.com:8070/', 'alice', 's3cret']);
  const { stdout, stderr } = await withOutput(() => commands.profileSetup(null, {}, prompt));
  assert.equal(prompt.asked.length, 5);
  assert.match(prompt.asked[0], /profile 名/);
  assert.equal(prompt.asked[0], prompt.asked[1], '空输入应重问同一问题');
  assert.match(prompt.asked[2], /Portal 地址/);
  assert.match(prompt.asked[3], /Portal 账号/);
  assert.match(prompt.asked[4], /Portal 密码/);
  assert.match(stderr, /进入交互式配置/);
  assert.match(stderr, /输入不能为空，请重新输入/);
  const cfg = readJSON(configFile);
  assert.deepEqual(cfg.profiles.fat, { baseUrl: 'http://portal.example.com:8070', portalEnv: 'FAT', cluster: 'default' });
  assert.equal(cfg.env.APOLLO_FAT_PASSWORD, 's3cret');
  assert.match(stdout, /已配置并登录成功/);
});

test('setup：交互取消后报错且不写文件', async () => {
  const prompt = fakePrompter(['fat', null]);
  await assert.rejects(
    withOutput(() => commands.profileSetup(null, {}, prompt)),
    /已取消（未完成配置）/
  );
  assert.equal(existsSync(configFile), false);
});

test('setup：登录验证失败时不落任何配置', async t => {
  fetchStub(t, () => redirectResponse('/signin'));
  await assert.rejects(
    withOutput(() => commands.profileSetup('fat', baseVals())),
    /用户名或密码错误（未保存任何配置，请修正后重试）/
  );
  assert.equal(existsSync(configFile), false);
  assert.equal(existsSync(sessionFile), false);
});

test('setup：已有同名 profile 保留 portal-env/cluster，且不自动改默认', async t => {
  seedUserConfig(iso.home, {
    default: 'dev',
    profiles: { dev: { baseUrl: 'http://d' }, fat: { baseUrl: 'http://old', portalEnv: 'FATX', cluster: 'c1' } }
  });
  okLoginStub(t);
  await withOutput(() => commands.profileSetup('fat', baseVals()));
  const cfg = readJSON(configFile);
  assert.equal(cfg.profiles.fat.baseUrl, 'http://portal.example.com:8070');
  assert.equal(cfg.profiles.fat.portalEnv, 'FATX');
  assert.equal(cfg.profiles.fat.cluster, 'c1');
  assert.equal(cfg.default, 'dev');
});

test('setup：--default 时设置默认 profile', async t => {
  seedUserConfig(iso.home, { default: 'dev', profiles: { dev: { baseUrl: 'http://d' } } });
  okLoginStub(t);
  const { stdout } = await withOutput(() => commands.profileSetup('fat', baseVals({ default: true })));
  assert.equal(readJSON(configFile).default, 'fat');
  assert.match(stdout, /默认 profile 已设为 "fat"/);
});

test('setup：提示项目级同名覆盖与 shell 变量遮蔽', async t => {
  seedProjectConfig(iso.home, { profiles: { fat: { baseUrl: 'http://proj' } } });
  const restore = setEnv({ APOLLO_FAT_USERNAME: 'envuser', APOLLO_FAT_PASSWORD: 'envpass' });
  try {
    okLoginStub(t);
    const { stderr } = await withOutput(() => commands.profileSetup('fat', baseVals()));
    assert.match(stderr, /项目配置中存在同名 profile "fat"/);
    assert.match(stderr, /shell 环境变量 APOLLO_FAT_USERNAME\/PASSWORD 已设置/);
  } finally {
    restore();
  }
});

test('setup：归一前缀冲突时提示共用环境变量', async t => {
  seedUserConfig(iso.home, { profiles: { 'fat.2': { baseUrl: 'http://x' } } });
  okLoginStub(t);
  const { stderr } = await withOutput(() => commands.profileSetup('fat-2', baseVals()));
  assert.match(stderr, /共用同一组环境变量（APOLLO_FAT_2_\*）/);
});
