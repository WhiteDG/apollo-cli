/**
 * Portal 请求统一入口：默认 30s 超时（网络黑洞时不无限挂起）与连接错误文案。
 */

export const TIMEOUT_MS = 30_000;

export function fetchWithTimeout(url, options = {}) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetch(url, { ...options, signal });
}

export function isTimeout(e) {
  return e?.name === 'TimeoutError';
}

export function netError(e, target) {
  if (isTimeout(e)) return `请求超时（${TIMEOUT_MS / 1000}s 无响应）: ${target}`;
  const cause = e?.cause?.code || e?.cause?.message || '';
  return `无法连接 ${target}${cause ? `（${cause}）` : ''}`;
}
