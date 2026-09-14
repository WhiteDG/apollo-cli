// warnOnce 按文件路径去重：同一路径的警告只会输出一次，因此对 session.json
// "无法读取"警告需要在独立测试文件（独立进程）中覆盖，避免与 store.test.js
// 的"内容损坏"警告用例互相消耗 warnedPaths 缓存。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupIsolatedHome, assertIsolated, withOutput } from './helpers.js';

const iso = setupIsolatedHome();
const store = await import('../src/store.js');
assertIsolated(iso);

after(() => iso.cleanup());

test('loadSession：路径不可读时警告一次并返回空对象（lenient 非 ENOENT 分支）', async () => {
  // 目录占位使 readFileSync 报 EISDIR（非 ENOENT），走 lenient 警告分支
  mkdirSync(join(iso.home, '.apollo-cli', 'session.json'), { recursive: true });

  const first = await withOutput(() => store.loadSession());
  assert.deepEqual(first.result, {});
  assert.match(first.stderr, /警告：无法读取 .*session\.json（.*），已忽略/);

  const second = await withOutput(() => store.loadSession());
  assert.deepEqual(second.result, {});
  assert.equal(second.stderr, '', '同一路径的警告只应输出一次');
});
