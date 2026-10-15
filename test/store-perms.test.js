// warnOnce 按「路径 + 文案」去重：凭据文件权限警告在独立测试文件中覆盖，
// 避免与其它用例互相消耗去重缓存（与 store-warn.test.js 同理）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupIsolatedHome, assertIsolated, withOutput } from './helpers.js';

const iso = setupIsolatedHome();
const store = await import('../src/store.js');
assertIsolated(iso);

const userDir = join(iso.home, '.apollo-cli');
const userConfigFile = join(userDir, 'config.json');

after(() => iso.cleanup());

test('凭据文件权限过宽时警告一次（POSIX）', { skip: process.platform === 'win32' }, async () => {
  mkdirSync(userDir, { recursive: true });
  writeFileSync(userConfigFile, '{}\n', 'utf8');
  chmodSync(userConfigFile, 0o644);

  const first = await withOutput(() => store.loadConfig());
  assert.match(first.stderr, /权限为 644，其中可能含凭据，建议执行 chmod 600/);

  const second = await withOutput(() => store.loadConfig());
  assert.equal(second.stderr, '', '同一文件的同一警告只输出一次');
});
