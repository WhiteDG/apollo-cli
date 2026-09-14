import { loadDotEnv } from './dotenv.js';
import { loadSession, saveSession } from './store.js';

export function envVarPrefix(envName) {
  return `APOLLO_${envName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_`;
}

function envVarName(envName, suffix) {
  return envVarPrefix(envName) + suffix;
}

export function resolveCredentials(envName, cliOpts) {
  // CLI flags first
  if (cliOpts.username && cliOpts.password) {
    return { username: cliOpts.username, password: cliOpts.password, from: '--flag' };
  }
  // Per-env env vars
  const perEnvUser = envVarName(envName, 'USERNAME');
  const perEnvPass = envVarName(envName, 'PASSWORD');
  if (process.env[perEnvUser] && process.env[perEnvPass]) {
    return { username: process.env[perEnvUser], password: process.env[perEnvPass], from: perEnvUser };
  }
  // Global fallback
  if (process.env.APOLLO_USERNAME && process.env.APOLLO_PASSWORD) {
    return { username: process.env.APOLLO_USERNAME, password: process.env.APOLLO_PASSWORD, from: 'APOLLO_USERNAME' };
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

export async function login(envName, creds, baseUrl) {
  const body = new URLSearchParams({
    username: creds.username,
    password: creds.password,
    'login-submit': '登录'
  });

  let resp;
  try {
    resp = await fetch(`${baseUrl}/signin`, {
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
    const cause = e.cause?.code || e.cause?.message || '';
    throw new Error(`无法连接 ${baseUrl}${cause ? `（${cause}）` : ''}`);
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
    verifyResp = await fetch(`${baseUrl}/apps`, {
      redirect: 'manual',
      headers: { cookie, accept: 'text/html,*/*' }
    });
  } catch (e) {
    const cause = e.cause?.code || e.cause?.message || '';
    throw new Error(`无法连接 ${baseUrl}（验证登录状态失败${cause ? `：${cause}` : ''}）`);
  }

  if (verifyResp.status === 302 && (verifyResp.headers.get('location') || '').includes('/signin')) {
    throw new Error('登录验证失败：cookie 无效或凭据有误');
  }

  return cookie;
}

export async function ensureSession(envName, baseUrl, cliOpts) {
  const sessions = loadSession();
  const stored = sessions[envName];
  if (stored && stored.baseUrl === baseUrl && stored.cookie) {
    return stored.cookie;
  }
  // Auto-login if credentials available
  loadDotEnv();
  const creds = resolveCredentials(envName, cliOpts || {});
  if (!creds) {
    throw new Error(`未登录，请先执行 "apollo-cli login ${envName}" 或设置 ${envVarPrefix(envName)}USERNAME/PASSWORD`);
  }
  const cookie = await login(envName, creds, baseUrl);
  saveSession(envName, { baseUrl, cookie, username: creds.username, savedAt: Date.now() });
  return cookie;
}

export async function reLogin(envName, baseUrl) {
  loadDotEnv();
  const creds = resolveCredentials(envName, {});
  if (!creds) return null;
  try {
    const cookie = await login(envName, creds, baseUrl);
    saveSession(envName, { baseUrl, cookie, username: creds.username, savedAt: Date.now() });
    return { cookie };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}