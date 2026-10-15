import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { setupIsolatedHome, assertIsolated, withOutput, writeJSONFile, setEnv } from './helpers.js';

// resolve.js 经 store.js 在模块加载期冻结 ~/.apollo-cli 路径，必须先完成隔离再动态 import
const iso = setupIsolatedHome();
const resolve = await import('../src/resolve.js');
assertIsolated(iso);

const userDir = join(iso.home, '.apollo-cli');
const userConfigFile = join(userDir, 'config.json');

beforeEach(() => {
  process.chdir(iso.home);
  rmSync(userDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(join(iso.home, 'apollo-cli.config.json'), { force: true });
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
    assert.deepEqual(resolve.resolveCredentials('dev', { username: 'cu', password: 'cp' }), {
      username: 'cu',
      password: 'cp',
      from: '--flag'
    });
  } finally {
    restore();
  }
});

test('resolveCredentials：profile 专属变量胜过全局变量', () => {
  const restore = setEnv({
    APOLLO_FAT_USERNAME: 'per-u',
    APOLLO_FAT_PASSWORD: 'per-p',
    APOLLO_USERNAME: 'global-u',
    APOLLO_PASSWORD: 'global-p'
  });
  try {
    assert.deepEqual(resolve.resolveCredentials('fat', {}), {
      username: 'per-u',
      password: 'per-p',
      from: 'APOLLO_FAT_USERNAME'
    });
  } finally {
    restore();
  }
});

test('resolveCredentials：profile 名规范化（非字母数字转下划线并大写）', () => {
  const restore = setEnv({
    APOLLO_FAT_2_USERNAME: 'u2',
    APOLLO_FAT_2_PASSWORD: 'p2',
    APOLLO_A_B_USERNAME: 'udot',
    APOLLO_A_B_PASSWORD: 'pdot'
  });
  try {
    assert.equal(resolve.resolveCredentials('fat-2', {}).username, 'u2');
    assert.equal(resolve.resolveCredentials('a.b', {}).username, 'udot');
  } finally {
    restore();
  }
});

test('resolveCredentials：专属变量只配一半时回退全局', () => {
  const restore = setEnv({ APOLLO_FAT_USERNAME: 'per-only', APOLLO_USERNAME: 'g-u', APOLLO_PASSWORD: 'g-p' });
  try {
    assert.deepEqual(resolve.resolveCredentials('fat', {}), { username: 'g-u', password: 'g-p', from: 'APOLLO_USERNAME' });
  } finally {
    restore();
  }
});

test('resolveCredentials：仅全局变量', () => {
  const restore = setEnv({ APOLLO_USERNAME: 'g-u', APOLLO_PASSWORD: 'g-p' });
  try {
    assert.deepEqual(resolve.resolveCredentials('dev', {}), { username: 'g-u', password: 'g-p', from: 'APOLLO_USERNAME' });
  } finally {
    restore();
  }
});

test('resolveCredentials：仅 --username 时 password 为空串', () => {
  assert.deepEqual(resolve.resolveCredentials('dev', { username: 'u' }), { username: 'u', password: '', from: '--username' });
  assert.deepEqual(resolve.resolveCredentials('dev', { username: 'u', password: '' }), {
    username: 'u',
    password: '',
    from: '--username'
  });
});

test('resolveCredentials：--password 单独提供无效，全无凭据返回 null', () => {
  assert.equal(resolve.resolveCredentials('dev', { password: 'p' }), null);
  assert.equal(resolve.resolveCredentials('dev', {}), null);
});

test('resolveCredentials：config.json 的 profile 字段提供凭据', async () => {
  const cfg = { profiles: { fat: { baseUrl: 'http://p', username: 'cfg-u', password: 'cfg-p' } }, env: {} };
  const { result } = await withOutput(() => resolve.resolveCredentials('fat', {}, cfg));
  assert.deepEqual(result, {
    username: 'cfg-u',
    password: 'cfg-p',
    from: 'profiles.fat'
  });
});

test('resolveCredentials：config.json 的 env 段提供凭据，profile 字段优先于 env 段', async () => {
  const both = {
    profiles: { fat: { username: 'field-u', password: 'field-p' } },
    env: { APOLLO_FAT_USERNAME: 'env-u', APOLLO_FAT_PASSWORD: 'env-p' }
  };
  const { result: first } = await withOutput(() => resolve.resolveCredentials('fat', {}, both));
  assert.deepEqual(first, {
    username: 'field-u',
    password: 'field-p',
    from: 'profiles.fat'
  });

  const envOnly = { profiles: {}, env: { APOLLO_FAT_USERNAME: 'env-u', APOLLO_FAT_PASSWORD: 'env-p' } };
  assert.deepEqual(resolve.resolveCredentials('fat', {}, envOnly), {
    username: 'env-u',
    password: 'env-p',
    from: 'APOLLO_FAT_USERNAME (config.json)'
  });

  const globalEnv = { profiles: {}, env: { APOLLO_USERNAME: 'g-u', APOLLO_PASSWORD: 'g-p' } };
  assert.deepEqual(resolve.resolveCredentials('fat', {}, globalEnv), {
    username: 'g-u',
    password: 'g-p',
    from: 'APOLLO_USERNAME (config.json)'
  });
});

test('resolveCredentials：进程环境变量（shell/.env）优先于 config.json 两个来源', () => {
  const restore = setEnv({ APOLLO_FAT_USERNAME: 'shell-u', APOLLO_FAT_PASSWORD: 'shell-p' });
  const cfg = {
    profiles: { fat: { username: 'field-u', password: 'field-p' } },
    env: { APOLLO_FAT_USERNAME: 'env-u', APOLLO_FAT_PASSWORD: 'env-p' }
  };
  try {
    assert.deepEqual(resolve.resolveCredentials('fat', {}, cfg), {
      username: 'shell-u',
      password: 'shell-p',
      from: 'APOLLO_FAT_USERNAME'
    });
  } finally {
    restore();
  }
});

test('resolveCredentials：config.json 凭据只配一半时忽略该来源', () => {
  assert.equal(resolve.resolveCredentials('fat', {}, { profiles: { fat: { username: 'only-u' } }, env: {} }), null);
  assert.equal(resolve.resolveCredentials('fat', {}, { profiles: {}, env: { APOLLO_FAT_USERNAME: 'only-u' } }), null);
});

test('resolveCredentials：手写凭据字段命中时警告一次（弃用提示）', async () => {
  const cfg = { profiles: { dep: { username: 'u', password: 'p' } }, env: {} };
  const first = await withOutput(() => resolve.resolveCredentials('dep', {}, cfg));
  assert.deepEqual(first.result, { username: 'u', password: 'p', from: 'profiles.dep' });
  assert.match(first.stderr, /已弃用/);
  assert.match(first.stderr, /APOLLO_DEP_USERNAME\/PASSWORD/);

  const second = await withOutput(() => resolve.resolveCredentials('dep', {}, cfg));
  assert.deepEqual(second.result, { username: 'u', password: 'p', from: 'profiles.dep' });
  assert.equal(second.stderr, '', '同一 profile 的弃用警告只输出一次');
});

// ---- getEnvVar ----

test('getEnvVar：process.env 优先于 config.json env 段', () => {
  writeJSONFile(userConfigFile, { profiles: {}, env: { APOLLO_PROFILE: 'from-cfg' } });
  const restore = setEnv({ APOLLO_PROFILE: 'from-env' });
  try {
    assert.equal(resolve.getEnvVar('APOLLO_PROFILE'), 'from-env');
  } finally {
    restore();
  }
});

test('getEnvVar：环境变量缺失时回退 config.json env 段，都没有返回 null', () => {
  writeJSONFile(userConfigFile, { profiles: {}, env: { APOLLO_PROFILE: 'from-cfg' } });
  assert.equal(resolve.getEnvVar('APOLLO_PROFILE'), 'from-cfg');
  assert.equal(resolve.getEnvVar('APOLLO_MISSING'), null);
});

// ---- credentialsHint ----

test('credentialsHint：来源列表由注册表生成，含归一后的变量名', () => {
  const hint = resolve.credentialsHint('fat-2');
  assert.match(hint, /^可用凭据来源（优先级从高到低）：--username\/--password/);
  assert.ok(hint.includes('环境变量 APOLLO_FAT_2_USERNAME/PASSWORD'));
  assert.ok(hint.includes('环境变量 APOLLO_USERNAME/PASSWORD'));
  assert.ok(hint.includes('config.json env 段的 APOLLO_FAT_2_USERNAME/PASSWORD'));
  assert.ok(hint.includes('config.json env 段的 APOLLO_USERNAME/APOLLO_PASSWORD'));
  assert.ok(hint.includes('手写凭据字段（已弃用）'));
  assert.equal(hint.includes('FAT-2'), false, '提示中不应出现未归一的 profile 名大写形式');
});
