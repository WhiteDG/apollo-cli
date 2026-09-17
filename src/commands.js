import { loadDotEnv } from './dotenv.js';
import {
  resolveProfile, getAllProfiles, saveUserConfig, removeProfile,
  loadSession, saveSession, clearSession, setDefaultProfile, getEnvVar
} from './store.js';
import { login as authLogin, resolveCredentials, ensureSession, profileVarPrefix } from './auth.js';
import * as api from './api.js';
import * as filecontent from './filecontent.js';
import { output } from './output.js';
import { createInterface } from 'node:readline';

function die(msg) {
  throw new Error(msg);
}

function fatal(err) {
  die(err instanceof Error ? err.message : String(err));
}

/** 写命令结果：--json 输出结构化数据，否则输出人类可读文案 */
function emit(opts, data, text) {
  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  process.stdout.write(text + '\n');
}

function pickProfile(opts) {
  return opts.profile || getEnvVar('APOLLO_PROFILE');
}

/**
 * Resolve profile from optional name hint, return expanded context.
 * Handles auto-selection (default/first profile).
 */
function profileCtx(hint, opts = {}) {
  loadDotEnv();
  const name = hint || pickProfile(opts) || null;
  const { profileName, config } = resolveProfile(name);
  return {
    profileName,
    baseUrl: config.baseUrl,
    portalEnv: config.portalEnv || profileName.toUpperCase(),
    cluster: opts.cluster || config.cluster || 'default',
    namespace: opts.namespace || 'application',
    config
  };
}

// ---- login ----

export async function login(profileArg, opts) {
  loadDotEnv();
  const name = profileArg || pickProfile(opts) || null;
  const { profileName, config, configFile } = resolveProfile(name);
  const baseUrl = config.baseUrl;
  const creds = resolveCredentials(profileName, opts, configFile);
  if (!creds) {
    die(`未找到凭据。请设置环境变量 ${profileVarPrefix(profileName)}USERNAME/PASSWORD, 或全局 APOLLO_USERNAME/PASSWORD, 或使用 --username/--password, 或在 config.json 中配置（profile 的 username/password 字段或 env 段）`);
  }
  const cookie = await authLogin(creds, baseUrl);
  saveSession(profileName, { baseUrl, cookie, username: creds.username, savedAt: Date.now() });
  emit(opts, { profile: profileName, baseUrl, username: creds.username }, `登录成功 (${profileName}: ${baseUrl}) [${creds.username}]`);
}

// ---- logout ----

export function logout(profileArg, opts = {}) {
  const ctx = profileCtx(profileArg, opts);
  clearSession(ctx.profileName);
  emit(opts, { profile: ctx.profileName }, `已清除 ${ctx.profileName} 的登录状态`);
}

// ---- profile ----

export function profileList(opts = {}) {
  const { profiles, default: def } = getAllProfiles();
  const sessions = loadSession();
  const keys = Object.keys(profiles);
  if (keys.length === 0) {
    if (opts.json) { output([], opts); return; }
    process.stdout.write('未配置 profile。使用 "apollo-cli profile add <name> --base-url <url>" 添加\n');
    return;
  }
  const rows = [];
  for (const name of keys) {
    const p = profiles[name];
    const session = sessions[name];
    const isDefault = name === def ? '✓' : '';
    const loggedIn = session && session.baseUrl === p.baseUrl ? '是' : '否';
    rows.push({
      profile: name,
      baseUrl: p.baseUrl,
      'Apollo环境': p.portalEnv || name.toUpperCase(),
      默认: isDefault,
      已登录: loggedIn
    });
  }
  output(rows, opts);
}

export function profileAdd(name, vals) {
  const portalEnv = vals['portal-env'] || name.toUpperCase();
  const data = {
    baseUrl: vals['base-url'].replace(/\/+$/, ''),
    portalEnv,
    cluster: vals.cluster || 'default'
  };
  if (vals.default) getAllProfiles(); // 预检：配置文件损坏在此抛错，避免"profile 已写、默认未设"的半写入
  saveUserConfig({ profiles: { [name]: data } });
  let def = null;
  if (vals.default) def = setDefaultProfile(name);
  const text = `profile "${name}" 已添加 (portal: ${portalEnv}, cluster: ${data.cluster})` +
    (def ? `\n默认 profile 已设为 "${name}"（已写入${def.scope}: ${def.path}）` : '');
  emit(vals, {
    name,
    portalEnv,
    cluster: data.cluster,
    default: !!vals.default,
    ...(def ? { defaultScope: def.scope, defaultPath: def.path } : {})
  }, text);
}

export function profileRm(name, opts = {}) {
  const scopes = removeProfile(name);
  if (scopes.length === 0) {
    die(`profile "${name}" 不存在`);
  }
  clearSession(name);
  emit(opts, { name, removedFrom: scopes }, `profile "${name}" 已删除（从${scopes.join('、')}中移除）`);
}

export function profileDefault(name, opts = {}) {
  const { profiles } = getAllProfiles();
  if (!profiles[name]) {
    die(`profile "${name}" 不存在`);
  }
  const { path, scope } = setDefaultProfile(name);
  emit(opts, { name, scope, path }, `默认 profile 已设为 "${name}"（已写入${scope}: ${path}）`);
}

// ---- ns ----

export async function nsList(appId, opts) {
  const ctx = profileCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.profileName, ctx.baseUrl, opts);
    const data = await api.getNamespaces(appId, ctx.portalEnv, ctx.cluster, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
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
      配置数: ns.items?.length ?? '-'
    }));
    output(rows, opts);
  } catch (e) { fatal(e); }
}

// ---- config ----

/**
 * 文件型命名空间判定需要 ns 的 format 字段：仅当 items 为空或恰有单个 content
 * 条目时才多查一次命名空间列表消歧；其余场景零额外请求，properties 行为不变。
 */
async function resolveFieldFormat(appId, ctx, items, cookie) {
  if (!filecontent.isAmbiguousNamespaceItems(items)) return null;
  const nsList = await api.getNamespaces(appId, ctx.portalEnv, ctx.cluster, {
    profileName: ctx.profileName,
    baseUrl: ctx.baseUrl,
    cookie
  });
  const format = filecontent.pickNamespaceFormat(nsList, ctx.namespace);
  return filecontent.isFileFormat(format) ? format : null;
}

export async function configList(appId, opts) {
  const ctx = profileCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.profileName, ctx.baseUrl, opts);
    const data = await api.getItems(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
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
  const ctx = profileCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.profileName, ctx.baseUrl, opts);
    const data = await api.getItems(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
    const items = Array.isArray(data) ? data : [];
    const format = await resolveFieldFormat(appId, ctx, items, cookie);
    if (format) {
      const contentItem = items.find(i => i.key === filecontent.CONTENT_KEY);
      if (!contentItem) {
        die(`字段 "${key}" 不存在（配置项 "${filecontent.CONTENT_KEY}" 尚未创建）`);
      }
      const { found, value } = filecontent.getField(contentItem.value, format, key);
      if (!found) die(`字段 "${key}" 不存在`);
      process.stdout.write(filecontent.renderFieldValue(value, format, opts));
      return;
    }
    const item = items.find(i => i.key === key);
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
  const ctx = profileCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.profileName, ctx.baseUrl, opts);
    const data = await api.getItems(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
    const session = loadSession()[ctx.profileName];
    const username = session?.username || '';
    const items = Array.isArray(data) ? data : [];
    const format = await resolveFieldFormat(appId, ctx, items, cookie);

    if (format) {
      const existing = items.find(i => i.key === filecontent.CONTENT_KEY);
      const parsed = filecontent.parseFieldValue(value, { string: !!opts.string });
      const prior = filecontent.getField(existing?.value ?? '', format, key);
      const next = filecontent.setField(existing?.value ?? '', format, key, parsed);
      const action = prior.found ? 'update' : 'create';
      const base = { action, key, namespace: ctx.namespace, value: parsed, needsPublish: true };
      if (opts['dry-run']) {
        if (existing) {
          emit(opts, { dryRun: true, ...base },
            `[dry-run] 将${prior.found ? '更新' : '新增'}字段 "${key}"（未执行；生效需 config publish）`);
        } else {
          emit(opts, { dryRun: true, ...base, contentItemCreated: true },
            `[dry-run] 将新增字段 "${key}"（将创建配置项 "${filecontent.CONTENT_KEY}"，未执行；生效需 config publish）`);
        }
        return;
      }
      if (existing) {
        await api.updateItem(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, {
          id: existing.id,
          key: filecontent.CONTENT_KEY,
          value: next,
          comment: opts.comment || existing.comment || '',
          dataChangeLastModifiedBy: username,
          dataChangeLastModifiedTime: new Date().toISOString()
        }, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
        emit(opts, base, `字段 "${key}" 已${prior.found ? '更新' : '新增'}（需 config publish 才生效）`);
      } else {
        await api.createItem(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, {
          key: filecontent.CONTENT_KEY,
          value: next,
          comment: opts.comment || '',
          dataChangeCreatedBy: username
        }, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
        emit(opts, { ...base, contentItemCreated: true },
          `字段 "${key}" 已新增（已创建配置项 "${filecontent.CONTENT_KEY}"，需 config publish 才生效）`);
      }
      return;
    }

    const existing = Array.isArray(data) ? data.find(i => i.key === key) : null;
    const base = { action: existing ? 'update' : 'create', key, namespace: ctx.namespace, value, needsPublish: true };
    if (opts['dry-run']) {
      emit(opts, { dryRun: true, ...base },
        `[dry-run] 将${existing ? '更新' : '新增'}配置项 "${key}"（未执行；生效需 config publish）`);
      return;
    }
    if (existing) {
      await api.updateItem(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, {
        id: existing.id,
        key,
        value,
        comment: opts.comment || existing.comment || '',
        dataChangeLastModifiedBy: username,
        dataChangeLastModifiedTime: new Date().toISOString()
      }, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
      emit(opts, base, `配置项 "${key}" 已更新（需 config publish 才生效）`);
      return;
    }
    await api.createItem(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, {
      key,
      value,
      comment: opts.comment || '',
      dataChangeCreatedBy: username
    }, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
    emit(opts, base, `配置项 "${key}" 已新增（需 config publish 才生效）`);
  } catch (e) { fatal(e); }
}

export async function configRm(appId, key, opts) {
  const ctx = profileCtx(null, opts);
  try {
    const cookie = await ensureSession(ctx.profileName, ctx.baseUrl, opts);
    const data = await api.getItems(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
    const item = Array.isArray(data) ? data.find(i => i.key === key) : null;
    if (!item) {
      die(`配置项 "${key}" 不存在`);
    }
    const base = { action: 'delete', key, namespace: ctx.namespace, needsPublish: true };
    if (opts['dry-run']) {
      emit(opts, { dryRun: true, ...base }, `[dry-run] 将删除配置项 "${key}"（未执行；生效需 config publish）`);
      return;
    }
    if (!opts.yes) {
      if (!process.stdin.isTTY) {
        die('非交互环境（stdin 不是终端），确认删除请使用 --yes');
      }
      const confirmed = await promptConfirm(`确定删除 "${key}" (值: ${(item.value || '').slice(0, 50)})？[y/N] `);
      if (confirmed === null) {
        die('stdin 已关闭（非交互环境），确认删除请使用 --yes');
      }
      if (!confirmed) {
        emit(opts, { cancelled: true, key, namespace: ctx.namespace }, '已取消');
        return;
      }
    }
    const session = loadSession()[ctx.profileName];
    await api.deleteItem(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, item.id, session?.username || '', { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
    emit(opts, base, `配置项 "${key}" 已删除（需 config publish 才生效）`);
  } catch (e) { fatal(e); }
}

export async function configPublish(appId, opts) {
  const ctx = profileCtx(null, opts);
  const now = new Date();
  const defaultTitle = `apollo-cli 发布 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const title = opts.title || defaultTitle;
  if (opts['dry-run']) {
    const detail = `title: ${title}` +
      (opts.emergency ? '，紧急发布' : '') +
      (opts.comment ? `，comment: ${opts.comment}` : '');
    emit(opts, {
      dryRun: true,
      action: 'publish',
      namespace: ctx.namespace,
      title,
      comment: opts.comment || '',
      emergency: !!opts.emergency
    }, `[dry-run] 将发布命名空间 "${ctx.namespace}"（${detail}；未执行）`);
    return;
  }
  try {
    const cookie = await ensureSession(ctx.profileName, ctx.baseUrl, opts);
    const session = loadSession()[ctx.profileName];
    const username = session?.username || '';
    const result = await api.publishRelease(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, {
      title,
      comment: opts.comment || '',
      releasedBy: username,
      emergency: opts.emergency || false
    }, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
    if (result && result.id !== undefined) {
      const t = result.releaseTitle ? `, title: ${result.releaseTitle}` : '';
      emit(opts, { action: 'publish', namespace: ctx.namespace, releaseId: result.id, title: result.releaseTitle || title },
        `发布成功 (releaseId: ${result.id}${t})`);
    } else {
      emit(opts, { action: 'publish', namespace: ctx.namespace, title }, '发布成功');
    }
  } catch (e) { fatal(e); }
}

export async function configReleases(appId, opts) {
  const ctx = profileCtx(null, opts);
  const limit = opts.limit || 10;
  try {
    const cookie = await ensureSession(ctx.profileName, ctx.baseUrl, opts);
    const data = await api.getActiveReleases(appId, ctx.portalEnv, ctx.cluster, ctx.namespace, limit, { profileName: ctx.profileName, baseUrl: ctx.baseUrl, cookie });
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