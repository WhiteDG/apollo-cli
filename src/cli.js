import { parseArgs } from 'node:util';
import * as runCommands from './commands.js';

const HELP = `apollo-cli — Apollo 配置中心命令行工具

用法:
  apollo-cli <命令> [参数]

登录/登出:
  login  [env]                 登录并保存 cookie
  logout [env]                 清除环境登录状态

环境管理:
  env list                     列出环境
  env add <name> --base-url    新增环境
    --base-url <url>               （必填）portal 地址
    --portal-env <env>              Apollo 内部环境名，默认 CLI 环境名大写
    --cluster <name>                默认集群，默认 "default"
    --default                       设为默认环境
  env rm <name>                删除环境
  env default <name>           设为默认环境

命名空间:
  ns ls <appId>                列出命名空间

配置管理:
  config ls <appId>            列出配置项
  config get <appId> <key>     获取单个配置项
  config set <appId> <key> <value>  新增或更新配置项
    --comment <text>
  config rm <appId> <key>      删除配置项（交互确认）
    --yes                          跳过确认
  config publish <appId>       发布配置
    --title <text>                 发布标题，默认 YYYY-MM-DD HH:mm
    --comment <text>               发布说明
    --emergency                    紧急发布
  config releases <appId>       发布历史
    --limit <n>                     条数，默认 10

全局选项:
  -e, --env <name>              选择 CLI 环境（默认取自 config.default）
  --cluster <name>              集群，默认读取环境配置（未配置则 "default"）
  -n, --namespace <name>        命名空间，默认 "application"
  --json                        输出 JSON 格式

示例:
  apollo-cli env add fat --base-url http://portal.example.com:8070 --default
  apollo-cli login fat
  apollo-cli config ls MyApp -n application
  apollo-cli config set MyApp timeout 5000 --comment "update timeout"
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
      env: { type: 'string', short: 'e' },
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

async function main(raw) {
  const cmd = raw[0];
  if (cmd === undefined || cmd === '--help' || cmd === '-h') printHelp();

  switch (cmd) {
    case 'login': {
      const p = parseArgs({ args: raw.slice(1), ...parseCfg({ username: { type: 'string' }, password: { type: 'string' } }) });
      return runCommands.login(p.positionals[0] || null, p.values);
    }
    case 'logout': {
      const p = parseArgs({ args: raw.slice(1), ...parseCfg() });
      return runCommands.logout(p.positionals[0] || null, p.values);
    }
    case 'env': return handleEnv(raw.slice(1));
    case 'ns': return handleNs(raw.slice(1));
    case 'config': return handleConfig(raw.slice(1));
    default: die(`未知命令: "${cmd}"\n可用命令: login, logout, env, ns, config`);
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

function handleEnv(args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    helpText(`用法:
  apollo-cli env list
  apollo-cli env add <name> --base-url <url> [--portal-env ENV] [--cluster CLUSTER] [--default]
  apollo-cli env rm <name>
  apollo-cli env default <name>\n`);
  }
  const sub = args[0];
  switch (sub) {
    case 'list': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg() });
      return runCommands.envList(p.values);
    }
    case 'add': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg({ 'base-url': { type: 'string' }, 'portal-env': { type: 'string' }, default: { type: 'boolean', default: false } }) });
      const [name] = pos(p, 1, 'env add <name> --base-url <url>');
      if (!p.values['base-url']) die('--base-url 是必填参数');
      return runCommands.envAdd(name, p.values);
    }
    case 'rm': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg() });
      const [name] = pos(p, 1, 'env rm <name>');
      return runCommands.envRm(name);
    }
    case 'default': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg() });
      const [name] = pos(p, 1, 'env default <name>');
      return runCommands.envDefault(name);
    }
    default: die(`未知 env 子命令: "${sub}"。可用: list, add, rm, default`);
  }
}

function handleNs(args) {
  const p = parseArgs({ args, ...parseCfg() });
  if (!p.positionals[0] || p.positionals[0] === '--help' || p.positionals[0] === '-h') {
    helpText(`用法: apollo-cli ns ls <appId>\n`);
  }
  if (p.positionals[0] !== 'ls') die(`未知 ns 子命令。可用: ls`);
  pos(p, 2, 'ns ls <appId>');
  return runCommands.nsList(p.positionals[1], p.values);
}

function handleConfig(args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    helpText(`用法:
  apollo-cli config ls <appId> [-n ns] [--json]
  apollo-cli config get <appId> <key> [-n ns] [--json]
  apollo-cli config set <appId> <key> <value> [-n ns] [--comment text]
  apollo-cli config rm <appId> <key> [-n ns] [--yes]
  apollo-cli config publish <appId> [-n ns] [--title t] [--comment c] [--emergency]
  apollo-cli config releases <appId> [-n ns] [--limit n] [--json]\n`);
  }
  const sub = args[0];
  switch (sub) {
    case 'ls': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg() });
      pos(p, 1, 'config ls <appId>');
      return runCommands.configList(p.positionals[0], p.values);
    }
    case 'get': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg() });
      pos(p, 2, 'config get <appId> <key>');
      return runCommands.configGet(p.positionals[0], p.positionals[1], p.values);
    }
    case 'set': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg({ comment: { type: 'string' } }) });
      pos(p, 3, 'config set <appId> <key> <value>');
      return runCommands.configSet(p.positionals[0], p.positionals[1], p.positionals[2], p.values);
    }
    case 'rm': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg({ yes: { type: 'boolean', default: false } }) });
      pos(p, 2, 'config rm <appId> <key>');
      return runCommands.configRm(p.positionals[0], p.positionals[1], p.values);
    }
    case 'publish': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg({ title: { type: 'string' }, comment: { type: 'string' }, emergency: { type: 'boolean', default: false } }) });
      pos(p, 1, 'config publish <appId>');
      return runCommands.configPublish(p.positionals[0], p.values);
    }
    case 'releases': {
      const p = parseArgs({ args: args.slice(1), ...parseCfg({ limit: { type: 'string', default: '10' } }) });
      pos(p, 1, 'config releases <appId>');
      const limit = Number(p.values.limit);
      if (!Number.isInteger(limit) || limit < 1) die(`--limit 必须是正整数（收到 "${p.values.limit}"）`);
      return runCommands.configReleases(p.positionals[0], { ...p.values, limit });
    }
    default: die(`未知 config 子命令: "${sub}"。可用: ls, get, set, rm, publish, releases`);
  }
}