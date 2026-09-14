import { reLogin, envVarPrefix } from './auth.js';

export async function portalRequest(method, pathname, opts = {}) {
  const { envName, baseUrl, body, cookie: suppliedCookie } = opts;

  async function doFetch(c) {
    const url = `${baseUrl.replace(/\/+$/, '')}${pathname}`;
    const headers = {
      accept: 'application/json,text/html,*/*',
      cookie: c
    };
    if (body && typeof body === 'object' && method !== 'GET' && method !== 'DELETE') {
      headers['content-type'] = 'application/json;charset=UTF-8';
    }
    try {
      return await fetch(url, {
        method,
        redirect: 'manual',
        headers,
        body: body && method !== 'GET' && method !== 'DELETE' ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      const cause = e.cause?.code || e.cause?.message || '';
      throw new Error(`无法连接 ${url}${cause ? `（${cause}）` : ''}`);
    }
  }

  let resp = await doFetch(suppliedCookie);

  // Check for session expiry
  if (resp.status === 401 || (resp.status >= 300 && resp.status < 400 && (resp.headers.get('location') || '').includes('/signin'))) {
    const relogin = await reLogin(envName, baseUrl);
    if (relogin?.cookie) {
      resp = await doFetch(relogin.cookie);
    } else {
      const reason = relogin?.error ? `，自动重新登录失败：${relogin.error}` : '，且未找到可用凭据';
      throw new Error(`登录已过期${reason}。请执行 "apollo-cli login ${envName}" 或配置 ${envVarPrefix(envName)}USERNAME/PASSWORD`);
    }
  }

  return resp;
}

export async function portalJSON(method, pathname, opts = {}) {
  const resp = await portalRequest(method, pathname, opts);
  const bodyText = await resp.text().catch(() => '');
  if (resp.status >= 400) {
    const msg = extractError(bodyText, resp.status);
    throw new Error(`请求失败 (${resp.status}): ${msg}`);
  }
  // 302 could be a redirect even after auth — treat as error for JSON routes
  if (resp.status >= 300 && resp.status < 400) {
    const loc = resp.headers.get('location') || '';
    if (loc.includes('/signin')) {
      throw new Error(`登录已过期，请重新登录`);
    }
    // non-signin redirect: follow manually for API convenience
    throw new Error(`请求被重定向 (${resp.status}) 到 ${loc}`);
  }
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error(`响应解析失败: ${bodyText.slice(0, 200)}`);
  }
}

function extractError(bodyText, status) {
  try {
    const json = JSON.parse(bodyText);
    return json.message || json.exception || json.error || bodyText.slice(0, 200);
  } catch {
    // HTML or plain text
    const stripped = bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 200);
    return stripped || `HTTP ${status}`;
  }
}