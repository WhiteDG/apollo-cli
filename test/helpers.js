import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

export function setupIsolatedHome() {
  const home = mkdtempSync(join(tmpdir(), 'apollo-cli-test-'));
  const origCwd = process.cwd();
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const origApollo = new Map();
  for (const key of Object.keys(process.env)) {
    // 大小写不敏感：Windows 上 process.env.APOLLO_X 能读到小写 apollo_x
    if (key.toUpperCase().startsWith('APOLLO_')) {
      origApollo.set(key, process.env[key]);
      delete process.env[key];
    }
  }

  process.env.USERPROFILE = home;
  process.env.HOME = home;
  process.chdir(home);

  let seq = 0;
  return {
    home,
    caseDir(name) {
      const dir = join(home, `case-${name ?? ++seq}`);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    cleanup() {
      // Windows 无法删除进程当前目录，必须先切回
      process.chdir(origCwd);
      for (const key of Object.keys(process.env)) {
        if (key.toUpperCase().startsWith('APOLLO_')) delete process.env[key];
      }
      for (const [key, value] of origApollo) process.env[key] = value;
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      if (origUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = origUserProfile;
      rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  };
}

export function assertIsolated(iso) {
  assert.equal(resolve(process.cwd()), resolve(iso.home), '测试进程 cwd 必须指向临时目录');
  assert.equal(resolve(process.env.USERPROFILE), resolve(iso.home), 'USERPROFILE 必须指向临时目录');
  assert.equal(existsSync(join(iso.home, '.env')), false, '临时目录不应存在 .env');
  assert.equal(existsSync(join(iso.home, 'apollo-cli.config.json')), false, '临时目录不应存在 apollo-cli.config.json');
}

export function setEnv(vars) {
  const prev = new Map();
  for (const [key, value] of Object.entries(vars)) {
    prev.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of prev) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/**
 * 捕获 stdout/stderr。必须转发到原方法：测试 runner 用子进程 stdout
 * 传输测试结果协议，只记录不转发会导致整轮卡死。禁止改用 t.mock 打桩 stdio。
 */
export async function withOutput(fn) {
  const out = [];
  const err = [];
  const wrap = (method, sink) =>
    function (...args) {
      const [chunk] = args;
      sink.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return method.apply(this, args);
    };
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = wrap(origOut, out);
  process.stderr.write = wrap(origErr, err);
  try {
    const result = await fn();
    return { stdout: out.join(''), stderr: err.join(''), stdoutChunks: out, stderrChunks: err, result };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

export function fetchStub(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const record = {
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
      redirect: init.redirect
    };
    calls.push(record);
    return handler(record, calls.length - 1);
  });
  return calls;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export function textResponse(text, status = 200, contentType = 'text/plain') {
  return new Response(text, { status, headers: { 'content-type': contentType } });
}

export function emptyResponse(status = 200) {
  return new Response(null, { status });
}

// 多条 set-cookie 必须用 append 逐条添加（数组形式会被 Headers 折叠成一条）
export function redirectResponse(location, cookies = []) {
  const headers = new Headers();
  if (location) headers.append('location', location);
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/** 文件型命名空间桩工厂：按 URL 后缀区分命名空间列表与 items 请求 */
export function fileNsHandler({ format = 'yml', items = [], namespace = 'application' } = {}) {
  return record => {
    if (record.url.endsWith('/namespaces')) {
      return jsonResponse([{ baseInfo: { namespaceName: namespace }, format }]);
    }
    if (record.method === 'GET') return jsonResponse(items);
    return jsonResponse(null);
  };
}

export function writeJSONFile(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export function seedUserConfig(home, config) {
  writeJSONFile(join(home, '.apollo-cli', 'config.json'), config);
}

export function seedProjectConfig(cwd, config) {
  writeJSONFile(join(cwd, 'apollo-cli.config.json'), config);
}

export function seedSession(home, envName, session) {
  writeJSONFile(join(home, '.apollo-cli', 'session.json'), { [envName]: session });
}
