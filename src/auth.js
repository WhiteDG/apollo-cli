import { loadDotEnv } from './dotenv.js';
import { loadSession, saveSession, loadConfig } from './store.js';
import { fetchWithTimeout, netError } from './http.js';

export function profileVarPrefix(profileName) {
  return `APOLLO_${profileName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_`;
}

function profileVarName(profileName, suffix) {
  return profileVarPrefix(profileName) + suffix;
}

/**
 * 凭据查找顺序：--username/--password → shell/.env 变量（专属 → 全局）
 * → config.json profile 的 username/password 字段 → config.json env 段（专属 → 全局）。
 */
export function resolveCredentials(profileName, cliOpts, cfg = {}) {
  // CLI flags first
  if (cliOpts.username && cliOpts.password) {
    return { username: cliOpts.username, password: cliOpts.password, from: '--flag' };
  }
  const perProfileUser = profileVarName(profileName, 'USERNAME');
  const perProfilePass = profileVarName(profileName, 'PASSWORD');
  // shell / .env（已并入 process.env）
  if (process.env[perProfileUser] && process.env[perProfilePass]) {
    return { username: process.env[perProfileUser], password: process.env[perProfilePass], from: perProfileUser };
  }
  if (process.env.APOLLO_USERNAME && process.env.APOLLO_PASSWORD) {
    return { username: process.env.APOLLO_USERNAME, password: process.env.APOLLO_PASSWORD, from: 'APOLLO_USERNAME' };
  }
  // config.json：profile 字段
  const profile = cfg.profiles?.[profileName];
  if (profile?.username && profile?.password) {
    return { username: profile.username, password: profile.password, from: `profiles.${profileName}` };
  }
  // config.json：env 段
  const cfgEnv = cfg.env || {};
  if (cfgEnv[perProfileUser] && cfgEnv[perProfilePass]) {
    return { username: cfgEnv[perProfileUser], password: cfgEnv[perProfilePass], from: `${perProfileUser} (config.json)` };
  }
  if (cfgEnv.APOLLO_USERNAME && cfgEnv.APOLLO_PASSWORD) {
    return { username: cfgEnv.APOLLO_USERNAME, password: cfgEnv.APOLLO_PASSWORD, from: 'APOLLO_USERNAME (config.json)' };
  }
  if (cliOpts.username) {
    return { username: cliOpts.username, password: cliOpts.password || '', from: '--username' };
  }
  return null;
}

function parseSetCookie(headers) {
  // Node.js >= 18 uses getSetCookie; also fallback to getAll('set-cookie')
  const cookies = [];
  try {
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : null;
    if (raw) {
      for (const entry of raw) {
        const nameEq = entry.split(';')[0];
        if (nameEq) cookies.push(nameEq);
      }
    }
  } catch {
    // ignore
  }
  // Fallback: single set-cookie header
  if (cookies.length === 0) {
    const raw = headers.get('set-cookie');
    if (raw) {
      for (const entry of raw.split(/,\s*(?=[a-zA-Z][^=]*=)/)) {
        const nameEq = entry.split(';')[0];
        if (nameEq) cookies.push(nameEq);
      }
    }
  }
  return cookies.join('; ');
}

export function extractCookie(headers) {
  const parsed = parseSetCookie(headers);
  if (!parsed.includes('JSESSIONID')) return null;
  // Append stable cookie
  let result = parsed;
  if (!result.includes('NG_TRANSLATE_LANG_KEY')) {
    result = 'NG_TRANSLATE_LANG_KEY=zh-CN; ' + result;
  }
  return result;
}

export async function login(creds, baseUrl) {
  const body = new URLSearchParams({
    username: creds.username,
    password: creds.password,
    'login-submit': '登录'
  });

  let resp;
  try {
    resp = await fetchWithTimeout(`${baseUrl}/signin`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        referer: `${baseUrl}/signin`,
        'upgrade-insecure-requests': '1',
        cookie: 'NG_TRANSLATE_LANG_KEY=zh-CN'
      },
      body
    });
  } catch (e) {
    throw new Error(netError(e, baseUrl));
  }

  const cookie = extractCookie(resp.headers);
  const location = resp.headers.get('location') || '';

  if (resp.status !== 302) {
    throw new Error(`登录失败：Portal 返回 HTTP ${resp.status}（${baseUrl}）`);
  }
  if (!cookie || location.includes('/signin')) {
    throw new Error('登录失败：用户名或密码错误');
  }

  // Verify: try accessing a protected page
  let verifyResp;
  try {
    verifyResp = await fetchWithTimeout(`${baseUrl}/apps`, {
      redirect: 'manual',
      headers: { cookie, accept: 'text/html,*/*' }
    });
  } catch (e) {
    throw new Error(`${netError(e, baseUrl)}（验证登录状态失败）`);
  }

  if (verifyResp.status === 302 && (verifyResp.headers.get('location') || '').includes('/signin')) {
    throw new Error('登录验证失败：cookie 无效或凭据有误');
  }

  return cookie;
}

export async function ensureSession(profileName, baseUrl, cliOpts) {
  const sessions = loadSession();
  const stored = sessions[profileName];
  if (stored && stored.baseUrl === baseUrl && stored.cookie) {
    return stored.cookie;
  }
  // Auto-login if credentials available
  loadDotEnv();
  const creds = resolveCredentials(profileName, cliOpts || {}, loadConfig());
  if (!creds) {
    throw new Error(`未登录，请先执行 "apollo-cli login ${profileName}" 或设置 ${profileVarPrefix(profileName)}USERNAME/PASSWORD（也可在 config.json 中配置）`);
  }
  const cookie = await login(creds, baseUrl);
  saveSession(profileName, { baseUrl, cookie, username: creds.username, savedAt: Date.now() });
  return cookie;
}

export async function reLogin(profileName, baseUrl) {
  loadDotEnv();
  const creds = resolveCredentials(profileName, {}, loadConfig());
  if (!creds) return null;
  try {
    const cookie = await login(creds, baseUrl);
    saveSession(profileName, { baseUrl, cookie, username: creds.username, savedAt: Date.now() });
    return { cookie };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}