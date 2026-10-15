import { loadConfig } from './store.js';

/** profile 名 → 环境变量前缀：非字母数字归一为下划线并大写（fat-2 与 fat.2 会归一到同一前缀） */
export function profileVarPrefix(profileName) {
  return `APOLLO_${profileName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_`;
}

function profileVarName(profileName, suffix) {
  return profileVarPrefix(profileName) + suffix;
}

function pair(store, userKey, passKey, from) {
  return store[userKey] && store[passKey] ? { username: store[userKey], password: store[passKey], from } : null;
}

/**
 * 凭据来源注册表：顺序即优先级，第一个命中的来源胜出。
 * - hint：生成统一的「可用凭据来源」提示文案（null 表示不作为完整凭据来源宣传）
 * - read(profileName, cliOpts, cfg)：返回 { username, password, from } 或 null
 * 新增来源只改这张表：解析、提示与测试都从它派生，不再有多处手写枚举。
 */
const CREDENTIAL_SOURCES = [
  {
    hint: '--username/--password',
    read: (profileName, cliOpts) =>
      cliOpts.username && cliOpts.password
        ? { username: cliOpts.username, password: cliOpts.password, from: '--flag' }
        : null
  },
  {
    hint: profileName => `环境变量 ${profileVarName(profileName, 'USERNAME')}/PASSWORD`,
    read: profileName => {
      const userKey = profileVarName(profileName, 'USERNAME');
      return pair(process.env, userKey, profileVarName(profileName, 'PASSWORD'), userKey);
    }
  },
  {
    hint: '环境变量 APOLLO_USERNAME/PASSWORD',
    read: () => pair(process.env, 'APOLLO_USERNAME', 'APOLLO_PASSWORD', 'APOLLO_USERNAME')
  },
  {
    hint: profileName => `config.json env 段的 ${profileVarName(profileName, 'USERNAME')}/PASSWORD`,
    read: (profileName, cliOpts, cfg) => {
      const userKey = profileVarName(profileName, 'USERNAME');
      return pair(cfg.env || {}, userKey, profileVarName(profileName, 'PASSWORD'), `${userKey} (config.json)`);
    }
  },
  {
    hint: 'config.json env 段的 APOLLO_USERNAME/APOLLO_PASSWORD',
    read: (profileName, cliOpts, cfg) =>
      pair(cfg.env || {}, 'APOLLO_USERNAME', 'APOLLO_PASSWORD', 'APOLLO_USERNAME (config.json)')
  },
  {
    // 仅用户名不足以完成登录，不列入提示；password 置空串，交给登录失败路径报错（现状保留）
    hint: null,
    read: (profileName, cliOpts) =>
      cliOpts.username ? { username: cliOpts.username, password: cliOpts.password || '', from: '--username' } : null
  }
];

/**
 * 凭据查找顺序：--username/--password → shell/.env 变量（专属 → 全局）
 * → config.json env 段（专属 → 全局）。
 */
export function resolveCredentials(profileName, cliOpts = {}, cfg = {}) {
  for (const source of CREDENTIAL_SOURCES) {
    const hit = source.read(profileName, cliOpts, cfg);
    if (hit) return hit;
  }
  return null;
}

/** 未找到凭据时的统一指引：来源列表由注册表生成，新增来源无需改各调用点 */
export function credentialsHint(profileName) {
  const ways = CREDENTIAL_SOURCES.filter(source => source.hint).map(source =>
    typeof source.hint === 'function' ? source.hint(profileName) : source.hint
  );
  return `可用凭据来源（优先级从高到低）：${ways.join('、')}`;
}

/**
 * 读取 CLI 使用的 APOLLO_* 变量：shell/.env（process.env）优先，
 * 回退 config.json 的 env 段（用户/项目合并，项目覆盖用户）。
 * 与 resolveCredentials 同属一个解析模块，共用「shell 优先于 config.json」的层级。
 */
export function getEnvVar(name) {
  if (process.env[name]) return process.env[name];
  return loadConfig().env[name] || null;
}
