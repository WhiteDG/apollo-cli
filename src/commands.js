import { loadDotEnv } from './dotenv.js';
import {
  resolveEnv, getAllEnvs, saveUserConfig, removeEnv,
  loadSession, saveSession, clearSession, setDefaultEnv
} from './store.js';
import { login as authLogin, resolveCredentials, ensureSession, envVarPrefix } from './auth.js';
import * as api from './api.js';
import { output } from './output.js';
import { createInterface } from 'node:readline';

function die(msg) {
  throw new Error(msg);
}

function fatal(err) {
  die(err instanceof Error ? err.message : String(err));
}

function pickEnv(opts) {
  return opts.env || process.env.APOLLO_ENV || null;
}

/**
 * Resolve environment from optional name hint, return expanded context.
 * Handles auto-selection (default/first env).
 */
function envCtx(hint, opts = {}) {
  loadDotEnv();
  const name = hint || pickEnv(opts) || null;
  const { envName, config } = resolveEnv(name);
  return {
    envName,
    baseUrl: config.baseUrl,
    portalEnv: config.portalEnv || envName.toUpperCase(),
    cluster: opts.cluster || config.cluster || 'default',
    namespace: opts.namespace || 'application',
    config
  };
}

// ---- login ----

export async function login(envArg, opts) {
  loadDotEnv();
  const name = envArg || pickEnv(opts) || null;
  const { envName, config } = resolveEnv(name);
  const baseUrl = config.baseUrl;
  const creds = resolveCredentials(envName, opts);
  if (!creds) {
    die(`未找到凭据。请设置环境变量 ${envVarPrefix(envName)}USERNAME/PASSWORD, 或全局 APOLLO_USERNAME/PASSWORD, 或使用 --username/--password`);
  }
  const cookie = await authLogin(envName, creds, baseUrl);
  saveSession(envName, { baseUrl, cookie, username: creds.username, savedAt: Date.now() });
  process.stdout.write(`登录成功 (${envName}: ${baseUrl}) [${creds.username}]\n`);
}

// ---- logout ----

export function logout(envArg, opts) {
  const ctx = envCtx(envArg, opts);
  clearSession(ctx.envName);
  process.stdout.write(`已清除 ${ctx.envName} 的登录状态\n`);
}

// ---- env ----

export function envList(opts = {}) {
  const { envs, default: def } = getAllEnvs();
  const sessions = loadSession();
  const keys = Object.keys(envs);
  if (keys.length === 0) {
    if (opts.json) { output([], opts); return; }
    process.stdout.write('未配置环境。使用 "apollo-cli env add <name> --base-url <url>" 添加\n');
    return;
  }
  const rows = [];
  for (const name of keys) {
    const e = envs[name];
    const session = sessions[name];
    const isDefault = name === def ? '✓' : '';
    const loggedIn = session && session.baseUrl === e.baseUrl ? '是' : '否';
    rows.push({
      环境: name,
      baseUrl: e.baseUrl,
      'Apollo环境': e.portalEnv || name.toUpperCase(),
      默认: isDefault,
      已登录: loggedIn
    });
  }
  output(rows, opts);
}

export function envAdd(name, vals) {
  const portalEnv = vals['portal-env'] || name.toUpperCase();
  const data = {
    baseUrl: vals['base-url'].replace(/\/+$/, ''),
    portalEnv,
    cluster: vals.cluster || 'default'
  };
  if (vals.default) getAllEnvs(); // 预检：配置文件损坏在此抛错，避免"环境已写、默认未设"的半写入
  saveUserConfig({ environments: { [name]: data } });
  process.stdout.write(`环境 "${name}" 已添加 (portal: ${portalEnv}, cluster: ${data.cluster})\n`);
  if (vals.default) {
    const { path, scope } = setDefaultEnv(name);
    process.stdout.write(`默认环境已设为 "${name}"（已写入${scope}: ${path}）\n`);
  }
}

export function envRm(name) {
  const scopes = removeEnv(name);
  if (scopes.length === 0) {
    die(`环境 "${name}" 不存在`);
  }
  clearSession(name);
  process.stdout.write(`环境 "${name}" 已删除（从${scopes.join('、')}中移除）\n`);
}

export function envDefault(name) {
  const { envs } = getAllEnvs();
  if (!envs[name]) {
    die(`环境 "${name}" 不存在`);
  }
  const { path, scope } = setDefaultEnv(name);
  process.stdout.write(`默认环境已设为 "${name}"（已写入${scope}: ${path}）\n`);
}

// ---- ns ----

export async function nsList(appId, opts) {
  const ctx = envCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.envName, ctx.baseUrl, opts);
    const data = await api.getNamespaces(appId, ctx.portalEnv, ctx.cluster, { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
    if (!Array.isArray(data) || data.length === 0) {
      if (opts.json) { output([], opts); return; }
      process.stdout.write('没有命名空间\n');
      return;
    }
    const rows = data.map(ns => ({
      appId,
      命名空间: ns.baseInfo?.namespaceName || ns.namespaceName || '-',
      格式: ns.format || 'properties',
      类型: ns.isPublic ? '公共' : '私有',
      配置数: ns.itemModifiedCnt ?? '-'
    }));
    output(rows, opts);
  } catch (e) { fatal(e); }
}

// ---- config ----

export async function configList(appId, opts) {
  const ctx = envCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.envName, ctx.baseUrl, opts);
    const data = await api.getItems(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
    if (!Array.isArray(data) || data.length === 0) {
      if (opts.json) { output([], opts); return; }
      process.stdout.write('没有配置项\n');
      return;
    }
    const rows = data.map(item => ({
      key: item.key,
      value: item.value,
      注释: item.comment || '',
      修改人: item.dataChangeLastModifiedBy || item.dataChangeCreatedBy || '',
      修改时间: item.dataChangeLastModifiedTime || item.dataChangeCreatedTime || ''
    }));
    output(rows, opts);
  } catch (e) { fatal(e); }
}

export async function configGet(appId, key, opts) {
  const ctx = envCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.envName, ctx.baseUrl, opts);
    const data = await api.getItems(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
    const item = Array.isArray(data) ? data.find(i => i.key === key) : null;
    if (!item) {
      die(`配置项 "${key}" 不存在`);
    }
    output([{
      key: item.key,
      value: item.value,
      注释: item.comment || '',
      修改人: item.dataChangeLastModifiedBy || item.dataChangeCreatedBy || '',
      修改时间: item.dataChangeLastModifiedTime || item.dataChangeCreatedTime || ''
    }], opts);
  } catch (e) { fatal(e); }
}

export async function configSet(appId, key, value, opts) {
  const ctx = envCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.envName, ctx.baseUrl, opts);
    const data = await api.getItems(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
    const session = loadSession()[ctx.envName];
    const username = session?.username || '';

    if (Array.isArray(data)) {
      const existing = data.find(i => i.key === key);
      if (existing) {
        await api.updateItem(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, {
          id: existing.id,
          key,
          value,
          comment: opts.comment || existing.comment || '',
          dataChangeLastModifiedBy: username,
          dataChangeLastModifiedTime: new Date().toISOString()
        }, { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
        process.stdout.write(`配置项 "${key}" 已更新\n`);
        return;
      }
    }
    await api.createItem(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, {
      key,
      value,
      comment: opts.comment || '',
      dataChangeCreatedBy: username
    }, { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
    process.stdout.write(`配置项 "${key}" 已新增\n`);
  } catch (e) { fatal(e); }
}

export async function configRm(appId, key, opts) {
  const ctx = envCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.envName, ctx.baseUrl, opts);
    const data = await api.getItems(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
    const item = Array.isArray(data) ? data.find(i => i.key === key) : null;
    if (!item) {
      die(`配置项 "${key}" 不存在`);
    }
    if (!opts.yes) {
      const confirmed = await promptConfirm(`确定删除 "${key}" (值: ${(item.value || '').slice(0, 50)})？[y/N] `);
      if (confirmed === null) {
        die('stdin 已关闭（非交互环境），确认删除请使用 --yes');
      }
      if (!confirmed) {
        process.stdout.write('已取消\n');
        return;
      }
    }
    const session = loadSession()[ctx.envName];
    await api.deleteItem(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, item.id, session?.username || '', { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
    process.stdout.write(`配置项 "${key}" 已删除\n`);
  } catch (e) { fatal(e); }
}

export async function configPublish(appId, opts) {
  const ctx = envCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.envName, ctx.baseUrl, opts);
    const session = loadSession()[ctx.envName];
    const username = session?.username || '';
    const now = new Date();
    const defaultTitle = `apollo-cli 发布 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const result = await api.publishRelease(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, {
      title: opts.title || defaultTitle,
      comment: opts.comment || '',
      releasedBy: username,
      emergency: opts.emergency || false
    }, { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
    if (result && result.id !== undefined) {
      const t = result.releaseTitle ? `, title: ${result.releaseTitle}` : '';
      process.stdout.write(`发布成功 (releaseId: ${result.id}${t})\n`);
    } else {
      process.stdout.write('发布成功\n');
    }
  } catch (e) { fatal(e); }
}

export async function configReleases(appId, opts) {
  const ctx = envCtx(null, opts);
  const limit = opts.limit || 10;
  try {
    const cookie = await ensureSession(ctx.envName, ctx.baseUrl, opts);
    const data = await api.getActiveReleases(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, limit, { envName: ctx.envName, baseUrl: ctx.baseUrl, cookie });
    const releases = Array.isArray(data) ? data : (data?.content || []);
    if (releases.length === 0) {
      if (opts.json) { output([], opts); return; }
      process.stdout.write('没有发布记录\n');
      return;
    }
    const rows = releases.map(r => ({
      id: r.releaseId ?? r.id,
      标题: r.releaseTitle || '',
      发布人: r.operator || r.releasedBy || '',
      时间: r.releaseTime || r.dataChangeCreatedTime || '',
      说明: r.releaseComment || ''
    }));
    output(rows, opts);
  } catch (e) { fatal(e); }
}

// ---- helpers ----

function promptConfirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise(resolve => {
    let answered = false;
    process.stderr.write(question);
    rl.once('line', line => {
      answered = true;
      rl.close();
      resolve(/^y(es)?$/i.test(line.trim()));
    });
    rl.once('SIGINT', () => {
      answered = true;
      rl.close();
      process.stderr.write('\n');
      resolve(false);
    });
    rl.once('close', () => {
      if (!answered) {
        process.stderr.write('\n');
        resolve(null);
      }
    });
  });
}