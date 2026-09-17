import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import * as runCommands from './commands.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `apollo-cli — Apollo 配置中心命令行工具

用法:
  apollo-cli <命令> [参数]

登录/登出:
  login  [profile]             登录并保存 cookie
  logout [profile]             清除 profile 登录状态

profile 管理:
  profile list                 列出 profile
  profile add <name> --base-url    新增 profile
    --base-url <url>               （必填）portal 地址
    --portal-env <env>              Apollo 内部环境名，默认 profile 名大写
    --cluster <name>                默认集群，默认 "default"
    --default                       设为默认 profile
  profile rm <name>            删除 profile
  profile default <name>       设为默认 profile

命名空间:
  ns ls <appId>                列出命名空间

配置管理:
  config ls <appId>            列出配置项
  config get <appId> <key|path>     获取配置项；文件型命名空间（yml/yaml/json）按字段路径，如 a.b[0].c
  config set <appId> <key|path> <value>  新增或更新（写入草稿）；文件型命名空间按字段写入
    --comment <text>
    --string                       值按字符串写入（不做 YAML 标量/结构解析）
    --dry-run                      仅预演：读取现状并输出计划，不写入
  config rm <appId> <key>      删除配置项（交互确认；非交互终端必须加 --yes）
    --yes                          跳过确认
    --dry-run                      仅预演：输出删除计划，不执行
  config publish <appId>       发布配置（草稿改动需发布才生效）
    --title <text>                 发布标题，默认 YYYY-MM-DD HH:mm
    --comment <text>               发布说明
    --emergency                    紧急发布
    --dry-run                      仅预演：输出发布计划，不上报
  config releases <appId>       发布历史
    --limit <n>                     条数，默认 10

全局选项（可放在子命令前或后）:
  -p, --profile <name>          选择 profile（默认取自 config.default）
  --cluster <name>              集群，默认读取 profile 配置（未配置则 "default"）
  -n, --namespace <name>        命名空间，默认 "application"
  --json                        输出 JSON 格式（读写命令均支持）
  -V, --version                 显示版本号

示例:
  apollo-cli profile add fat --base-url http://portal.example.com:8070 --default
  apollo-cli login fat
  apollo-cli config ls MyApp -n application
  apollo-cli --json config get MyApp timeout -p fat
  apollo-cli config set MyApp timeout 5000 --comment "update timeout"
  apollo-cli config set MyApp 'server.ports[0]' 8080 -n app.yml   # 文件型命名空间按字段路径（含 [] 的路径建议加引号，避免 shell glob）
  apollo-cli config publish MyApp --title "v1.0.1" --emergency
`;

class HelpExit extends Error {}

function die(msg) {
  throw new Error(msg);
}

function parseCfg(extra = {}) {
  return {
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      profile: { type: 'string', short: 'p' },
      cluster: { type: 'string' },
      namespace: { type: 'string', short: 'n', default: 'application' },
      json: { type: 'boolean', default: false },
      ...extra
    }
  };
}

function pos(parsed, n, usage) {
  if (parsed.positionals.length < n) die(`缺少参数。用法: ${usage}`);
  return parsed.positionals;
}

export async function run() {
  try {
    await main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof HelpExit) return;
    process.exitCode = 1;
    process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n');
  }
}

// 取值型全局选项：扫描前置选项时需连带跳过其参数值
const GLOBAL_VALUE_OPTS = new Set(['-p', '--profile', '-n', '--namespace', '--cluster']);
const STOP_TOKENS = new Set(['-h', '--help', '-V', '--version', '--']);

/** 把命令前的全局选项与命令本身分开：apollo-cli --json -p fat config ls App */
function splitGlobalPrefix(raw) {
  const prefix = [];
  let i = 0;
  while (i < raw.length) {
    const tok = raw[i];
    if (!tok.startsWith('-') || tok === '-' || STOP_TOKENS.has(tok)) break;
    prefix.push(tok);
    if (GLOBAL_VALUE_OPTS.has(tok) && i + 1 < raw.length) prefix.push(raw[++i]);
    i++;
  }
  return { prefix, rest: raw.slice(i) };
}

function translateParseError(e) {
  const msg = e instanceof Error ? e.message : String(e);
  let m = msg.match(/^Unknown option '([^']+)'/);
  if (m) return `未知选项 '${m[1]}'（如参数值以 '-' 开头，请放在 "--" 之后）`;
  m = msg.match(/^Option '([^']+)' argument missing/);
  if (m) return `选项 '${m[1]}' 缺少参数值`;
  m = msg.match(/^Option '([^']+)' does not take an argument/);
  if (m) return `选项 '${m[1]}' 不接受参数值`;
  return `参数解析失败: ${msg}`;
}

function parseCli(cfg) {
  try {
    return parseArgs(cfg);
  } catch (e) {
    die(translateParseError(e));
  }
}

async function main(raw) {
  const { prefix, rest } = splitGlobalPrefix(raw);
  const cmd = rest[0];
  if (cmd === undefined) {
    if (raw.length === 0) printHelp();
    parseCli({ args: prefix, ...parseCfg() }); // 前缀选项非法时优先报选项错误
    die('缺少命令。可用命令: login, logout, profile, ns, config');
  }
  if (cmd === '--help' || cmd === '-h') printHelp();
  if (cmd === '--version' || cmd === '-V') {
    process.stdout.write(`apollo-cli ${pkg.version}\n`);
    return;
  }
  const args = [...prefix, ...rest.slice(1)];

  switch (cmd) {
    case 'login': {
      const p = parseCli({ args, ...parseCfg({ username: { type: 'string' }, password: { type: 'string' } }) });
      return runCommands.login(p.positionals[0] || null, p.values);
    }
    case 'logout': {
      const p = parseCli({ args, ...parseCfg() });
      return runCommands.logout(p.positionals[0] || null, p.values);
    }
    case 'profile': return handleProfile(args);
    case 'ns': return handleNs(args);
    case 'config': return handleConfig(args);
    default: die(`未知命令: "${cmd}"\n可用命令: login, logout, profile, ns, config`);
  }
}

function printHelp() {
  process.stdout.write(HELP);
  throw new HelpExit();
}

function helpText(text) {
  process.stdout.write(text);
  throw new HelpExit();
}

function handleProfile(rawArgs) {
  const { prefix, rest } = splitGlobalPrefix(rawArgs);
  const sub = rest[0];
  if (sub === undefined || sub === '--help' || sub === '-h') {
    if (prefix.length > 0) parseCli({ args: prefix, ...parseCfg() });
    helpText(`用法:
  apollo-cli profile list
  apollo-cli profile add <name> --base-url <url> [--portal-env ENV] [--cluster CLUSTER] [--default]
  apollo-cli profile rm <name>
  apollo-cli profile default <name>\n`);
  }
  const args = [...prefix, ...rest.slice(1)];
  switch (sub) {
    case 'list': {
      const p = parseCli({ args, ...parseCfg() });
      return runCommands.profileList(p.values);
    }
    case 'add': {
      const p = parseCli({ args, ...parseCfg({ 'base-url': { type: 'string' }, 'portal-env': { type: 'string' }, default: { type: 'boolean', default: false } }) });
      const [name] = pos(p, 1, 'profile add <name> --base-url <url>');
      if (!p.values['base-url']) die('--base-url 是必填参数');
      return runCommands.profileAdd(name, p.values);
    }
    case 'rm': {
      const p = parseCli({ args, ...parseCfg() });
      const [name] = pos(p, 1, 'profile rm <name>');
      return runCommands.profileRm(name, p.values);
    }
    case 'default': {
      const p = parseCli({ args, ...parseCfg() });
      const [name] = pos(p, 1, 'profile default <name>');
      return runCommands.profileDefault(name, p.values);
    }
    default: die(`未知 profile 子命令: "${sub}"。可用: list, add, rm, default`);
  }
}

function handleNs(rawArgs) {
  const { prefix, rest } = splitGlobalPrefix(rawArgs);
  const sub = rest[0];
  if (sub === undefined || sub === '--help' || sub === '-h') {
    if (prefix.length > 0) parseCli({ args: prefix, ...parseCfg() });
    helpText(`用法: apollo-cli ns ls <appId>\n`);
  }
  if (sub !== 'ls') die(`未知 ns 子命令。可用: ls`);
  const p = parseCli({ args: [...prefix, ...rest.slice(1)], ...parseCfg() });
  pos(p, 1, 'ns ls <appId>');
  return runCommands.nsList(p.positionals[0], p.values);
}

function handleConfig(rawArgs) {
  const { prefix, rest } = splitGlobalPrefix(rawArgs);
  const sub = rest[0];
  if (sub === undefined || sub === '--help' || sub === '-h') {
    if (prefix.length > 0) parseCli({ args: prefix, ...parseCfg() });
    helpText(`用法:
  apollo-cli config ls <appId> [-n ns] [--json]
  apollo-cli config get <appId> <key|path> [-n ns] [--json]
  apollo-cli config set <appId> <key|path> <value> [-n ns] [--comment text] [--string] [--dry-run]
  apollo-cli config rm <appId> <key> [-n ns] [--yes] [--dry-run]
  apollo-cli config publish <appId> [-n ns] [--title t] [--comment c] [--emergency] [--dry-run]
  apollo-cli config releases <appId> [-n ns] [--limit n] [--json]\n`);
  }
  const args = [...prefix, ...rest.slice(1)];
  switch (sub) {
    case 'ls': {
      const p = parseCli({ args, ...parseCfg() });
      pos(p, 1, 'config ls <appId>');
      return runCommands.configList(p.positionals[0], p.values);
    }
    case 'get': {
      const p = parseCli({ args, ...parseCfg() });
      pos(p, 2, 'config get <appId> <key>');
      return runCommands.configGet(p.positionals[0], p.positionals[1], p.values);
    }
    case 'set': {
      const p = parseCli({ args, ...parseCfg({
        comment: { type: 'string' },
        string: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false }
      }) });
      pos(p, 3, 'config set <appId> <key> <value>');
      return runCommands.configSet(p.positionals[0], p.positionals[1], p.positionals[2], p.values);
    }
    case 'rm': {
      const p = parseCli({ args, ...parseCfg({
        yes: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false }
      }) });
      pos(p, 2, 'config rm <appId> <key>');
      return runCommands.configRm(p.positionals[0], p.positionals[1], p.values);
    }
    case 'publish': {
      const p = parseCli({ args, ...parseCfg({
        title: { type: 'string' },
        comment: { type: 'string' },
        emergency: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false }
      }) });
      pos(p, 1, 'config publish <appId>');
      return runCommands.configPublish(p.positionals[0], p.values);
    }
    case 'releases': {
      const p = parseCli({ args, ...parseCfg({ limit: { type: 'string', default: '10' } }) });
      pos(p, 1, 'config releases <appId>');
      const limit = Number(p.values.limit);
      if (!Number.isInteger(limit) || limit < 1) die(`--limit 必须是正整数（收到 "${p.values.limit}"）`);
      return runCommands.configReleases(p.positionals[0], { ...p.values, limit });
    }
    default: die(`未知 config 子命令: "${sub}"。可用: ls, get, set, rm, publish, releases`);
  }
}