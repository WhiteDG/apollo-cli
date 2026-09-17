import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';

const USER_DIR = resolve(homedir(), '.apollo-cli');
const USER_CONFIG = resolve(USER_DIR, 'config.json');
const SESSION_FILE = resolve(USER_DIR, 'session.json');
const PROJECT_CONFIG = 'apollo-cli.config.json';

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

const warnedPaths = new Set();

function readJSON(path, { lenient = false } = {}) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    if (lenient) {
      warnOnce(path, `警告：无法读取 ${path}（${e.message}），已忽略`);
      return null;
    }
    throw new Error(`读取配置失败: ${path}（${e.message}）`);
  }
  try {
    return JSON.parse(text);
  } catch {
    if (lenient) {
      warnOnce(path, `警告：${path} 内容损坏，已忽略（将自动重建）`);
      return null;
    }
    throw new Error(`配置文件损坏（不是合法 JSON）: ${path}\n请修复或删除该文件后重试`);
  }
}

function warnOnce(path, msg) {
  if (warnedPaths.has(path)) return;
  warnedPaths.add(path);
  process.stderr.write(msg + '\n');
}

function atomicWrite(path, content, options = 'utf8') {
  cleanStaleTmp(path);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, options);
  // Windows 上目标文件可能被杀软/同步软件瞬时锁定导致 rename 失败，重试几次后降级为直接写
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      if (e.code === 'ENOENT') break; // tmp 被外部清理，无法 rename，直接降级写
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      if (i >= 2) break;
      sleep(50);
    }
  }
  writeFileSync(path, content, options);
  try { rmSync(tmp, { force: true }); } catch { /* 残留 tmp 不影响后续写入 */ }
}

// 清理崩溃进程遗留的陈旧 tmp（同目录、同 basename、pid 后缀、超过 10 分钟）
function cleanStaleTmp(path) {
  const dir = dirname(path);
  const name = basename(path);
  try {
    for (const entry of readdirSync(dir)) {
      const m = entry.match(/^(.+)\.(\d+)\.tmp$/);
      if (!m || m[1] !== name) continue;
      const full = join(dir, entry);
      if (Date.now() - statSync(full).mtimeMs > 10 * 60 * 1000) {
        rmSync(full, { force: true });
      }
    }
  } catch { /* 清理失败不影响写入 */ }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeJSON(path, data) {
  ensureDir(USER_DIR);
  atomicWrite(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---- config ----

export function loadConfig() {
  const user = readJSON(USER_CONFIG);
  const project = existsSync(PROJECT_CONFIG) ? readJSON(PROJECT_CONFIG) : null;

  // merge: project overrides user
  const result = { default: null, profiles: {}, env: {} };
  if (user) {
    result.default = user.default || null;
    if (user.profiles) Object.assign(result.profiles, user.profiles);
    if (user.env) Object.assign(result.env, user.env);
  }
  if (project) {
    if (project.default) result.default = project.default;
    if (project.profiles) Object.assign(result.profiles, project.profiles);
    if (project.env) Object.assign(result.env, project.env);
  }
  return result;
}

/**
 * 读取 CLI 使用的 APOLLO_* 变量：shell/.env（process.env）优先，
 * 回退 config.json 的 env 段（用户/项目合并，项目覆盖用户）。
 */
export function getEnvVar(name) {
  if (process.env[name]) return process.env[name];
  return loadConfig().env[name] || null;
}

export function resolveProfile(profileName) {
  const config = loadConfig();
  const profiles = config.profiles;
  const keys = Object.keys(profiles);

  if (profileName) {
    if (!profiles[profileName]) return dieMsg(`profile "${profileName}" 未配置。可用: ${keys.join(', ')}`);
    return { config: profiles[profileName], configFile: config, profileName };
  }

  // auto-select
  if (keys.length === 0) return dieMsg('未配置任何 profile。请先执行 "apollo-cli profile add <name> --base-url <url>"');
  const picked = config.default || keys[0];
  if (!profiles[picked]) return dieMsg(`默认 profile "${picked}" 不存在`);
  return { config: profiles[picked], configFile: config, profileName: picked };
}

export function getAllProfiles() {
  const config = loadConfig();
  return { profiles: config.profiles, default: config.default };
}

export function saveUserConfig(data) {
  const existing = readJSON(USER_CONFIG) || { profiles: {} };
  // 按字段合并同名 profile：保留手写的 username/password 等字段
  const merged = { ...existing.profiles };
  for (const [name, profile] of Object.entries(data.profiles || {})) {
    merged[name] = { ...merged[name], ...profile };
  }
  // 保留其它顶层键（如 env 段）
  writeJSON(USER_CONFIG, {
    ...existing,
    default: data.default !== undefined ? data.default : existing.default,
    profiles: merged
  });
}

export function removeProfile(name) {
  const scopes = [];
  const user = readJSON(USER_CONFIG);
  if (user && user.profiles && user.profiles[name]) {
    delete user.profiles[name];
    if (user.default === name) user.default = null;
    writeJSON(USER_CONFIG, user);
    scopes.push('用户配置');
  }
  if (existsSync(PROJECT_CONFIG)) {
    const project = readJSON(PROJECT_CONFIG);
    if (project && project.profiles && project.profiles[name]) {
      delete project.profiles[name];
      if (project.default === name) project.default = null;
      atomicWrite(PROJECT_CONFIG, JSON.stringify(project, null, 2) + '\n', 'utf8');
      scopes.push('项目配置');
    }
  }
  return scopes;
}

/**
 * Set default profile in the file that controls the effective default:
 * project config wins when it declares a default, else user config.
 */
export function setDefaultProfile(name) {
  const project = existsSync(PROJECT_CONFIG) ? readJSON(PROJECT_CONFIG) : null;
  if (project && project.default) {
    project.default = name;
    atomicWrite(PROJECT_CONFIG, JSON.stringify(project, null, 2) + '\n', 'utf8');
    return { path: resolve(process.cwd(), PROJECT_CONFIG), scope: '项目配置' };
  }
  const user = readJSON(USER_CONFIG) || { profiles: {} };
  user.default = name;
  writeJSON(USER_CONFIG, user);
  return { path: USER_CONFIG, scope: '用户配置' };
}

// ---- session ----

export function loadSession() {
  return readJSON(SESSION_FILE, { lenient: true }) || {};
}

export function saveSession(profileName, data) {
  const all = loadSession();
  all[profileName] = data;
  ensureDir(USER_DIR);
  atomicWrite(SESSION_FILE, JSON.stringify(all, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

export function clearSession(profileName) {
  const all = loadSession();
  // 无可清除项时不写盘：用户目录可能不存在（从未登录过），atomicWrite 会抛 ENOENT
  if (!Object.hasOwn(all, profileName)) return;
  delete all[profileName];
  atomicWrite(SESSION_FILE, JSON.stringify(all, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

function dieMsg(msg) {
  throw new Error(msg);
}