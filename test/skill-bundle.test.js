import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件不 import src，只 spawn 自带打包产物与 scripts/build.js --check，故不需要 setupIsolatedHome()；
// 但子进程必须传隔离后的 HOME/USERPROFILE，并清空 APOLLO_*，绝不碰真实 ~/.apollo-cli
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(repoRoot, 'skills', 'apollo', 'scripts', 'apollo-cli.cjs');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

function isolatedEnv(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of Object.keys(env)) {
    // 大小写不敏感：Windows 上能读到小写 apollo_ 前缀变量
    if (key.toUpperCase().startsWith('APOLLO_')) delete env[key];
  }
  return env;
}

test('skill 自带的产物可独立运行且版本与 package.json 一致', () => {
  assert.ok(existsSync(bundlePath), '缺少 skills/apollo/scripts/apollo-cli.cjs，请运行 pnpm build');
  const dir = mkdtempSync(join(tmpdir(), 'apollo-cli-bundle-'));
  try {
    // 拷到临时目录再跑：产物必须独立于本仓库（模拟 skill 被安装到别处）
    const copy = join(dir, 'apollo-cli.cjs');
    copyFileSync(bundlePath, copy);
    const r = spawnSync(process.execPath, [copy, '--version'], {
      cwd: dir, env: isolatedEnv(dir), encoding: 'utf8'
    });
    assert.equal(r.status, 0, `产物运行失败: ${r.stderr}`);
    assert.equal(r.stdout.trim(), `apollo-cli ${pkg.version}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test('产物与源码同步（改 src/package.json 后必须 pnpm build 并提交产物）', () => {
  const r = spawnSync(process.execPath, ['scripts/build.js', '--check'], {
    cwd: repoRoot, encoding: 'utf8'
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});
