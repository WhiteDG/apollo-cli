# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

## 命令

- 直接运行：`node bin/apollo-cli.js --help`（或 `pnpm link --global` 后用 `apollo-cli`）。
- 依赖安装：`pnpm install`（包管理器用 pnpm，lock 文件为 `pnpm-lock.yaml`）。
- 打包单文件产物：`pnpm build`（esbuild 打包为 `skills/apollo/scripts/apollo-cli.cjs`，随 skill 一起分发，**产物必须提交进 git**）。改 `src/`、`bin/`、`package.json` 后必须重新 `pnpm build` 并提交产物；`pnpm build:check`（= `node scripts/build.js --check`）只读校验产物是否最新，`test/skill-bundle.test.js` 会强制这条纪律。产物扩展名须为 `.cjs`：`.js` 的模块语义取决于所在目录的 package.json，放进本仓库会被 `"type": "module"` 当 ESM 解析。
- 测试：`pnpm test`（即 `node --test "test/**/*.test.js"`）；单文件 `node --test test/store.test.js`；调试单文件可直接 `node test/store.test.js`（TAP 直出）。不要用 `node --test test/`，目录参数会被当成文件报错。
- 无 lint、格式化配置。快速静态检查用 `node --check <file>`，再人工审查代码。

## skill

- `skills/apollo/` 是随仓库分发的 AI skill（`SKILL.md` + `evals/` + `scripts/apollo-cli.cjs` + `README.md`）：用户机器上有 Node >= 21 即可直接跑自带产物，无需安装本包；skill 不走 npm 分发，`package.json` 的 `files` 无需加 `skills`。
- SKILL.md 里统一用 `node <SK>/scripts/apollo-cli.cjs <命令>`（`<SK>` = SKILL.md 所在目录的绝对路径；正文没有 `${SKILL_ROOT}` 之类变量，靠文首的解析阶梯得到）。改调用方式时要连同"命令速查/典型流程"一起改。
- SKILL.md、README、evals 随 skill 独立分发，必须脱离本仓库语境：只讲"技能自带的 CLI 怎么用"，不出现"打包/产物/单文件/npm 安装"等描述（这些只属于仓库文档与 `scripts/build.js`）。
- 产物已入库，改完源码忘记重打包会让拿到 skill 的用户执行旧版本；`.gitattributes` 把该产物固定为 LF，保证仓库内与该文件在各平台的检出内容一致（`scripts/build.js --check` 另有 CRLF 归一兜底，不会误报过期）。
- 手动跑自带产物做验证时先 `cd` 到临时目录：CLI 按当前目录读写项目级 `apollo-cli.config.json`（含凭据、已 gitignore），在仓库根直接跑写命令（如 `profile add`、默认 profile 变更）会改动仓库里真实的该文件。

## 语言

- 用户可见字符串（帮助、错误信息、表头）、代码注释、commit message 一律用中文。
- commit 格式：`type: 中文描述`，如 `feat: 新增 Apollo 配置中心 CLI 工具`。

## 依赖

- 运行时依赖仅 `yaml@^2`（eemeli/yaml，零传递依赖）：用于 yml/yaml 命名空间的解析与保注释回写（`src/filecontent.js`）；JSON 用内置 `JSON.parse/stringify`。devDependency 仅 `esbuild`（`pnpm build` 打包单文件用，不参与运行时，理由：唯一依赖 yaml 为纯 JS，可整体内联）。
- 包管理器用 pnpm；`pnpm-lock.yaml` 需提交。除此之外仅用 Node 内置模块，新增依赖需说明理由。

## 代码风格

- ESM（`"type": "module"`），相对导入必须写 `.js` 扩展名。
- 2 空格缩进、单引号、具名导出。
- 错误处理：`die()`/`fatal()` 抛 Error，由 `src/cli.js` 的 `run()` 统一捕获并置 exitCode=1；`HelpExit` 用于打印帮助后退出，不要捕获吞掉它。

## 测试

- 测试工具只用 Node 内置 `node:test` + `node:assert/strict`。测试放 `test/`，命名 `*.test.js`；`test/helpers.js` 是共享工具（顶层零副作用、不 import src）。
- `test/filecontent.test.js`、`test/http.test.js`、`test/prompt.test.js` 为无需 `setupIsolatedHome()` 的测试（prompt 用注入流，http 只打桩 `globalThis.fetch`）；`test/skill-bundle.test.js` 不 import src，只 spawn 打包产物与 `scripts/build.js --check`，也不需要 `setupIsolatedHome()`，但必须给子进程传隔离的 HOME/USERPROFILE 并清空 `APOLLO_*`，绝不碰真实 `~/.apollo-cli`；其余文件按隔离纪律执行。
- 隔离纪律（`src/store.js` 在模块加载期冻结 `~/.apollo-cli` 路径）：需要 store 的测试文件必须在**动态 `import()` src 之前**完成：`mkdtemp` → 设 `USERPROFILE`（Windows 上 `HOME` 无效，一并设置无害）→ `chdir` 临时目录 → 清空 `APOLLO_*`。用 `setupIsolatedHome()`，并用 `assertIsolated()` 兜底断言。
- 测试绝不读取仓库真实 `.env` 与 `apollo-cli.config.json`，fetch 一律用 `t.mock.method(globalThis, 'fetch', ...)` 打桩，不访问网络。
- 捕获 stdout/stderr 必须转发到原函数（测试 runner 用子进程 stdout 传协议，只记录不转发会整轮卡死）；禁止用 `t.mock` 打桩 stdio。
- `run()` 测试包装器必须在 finally 复位 `process.argv`/`process.exitCode`（残留 1 会让整个文件判失败）。
- `config rm` 未带 `--yes` 且 stdin 非 TTY 时会立即报错（`src/commands.js` 有 `isTTY` 预检，不会挂起），可直接断言该报错；用 `setStdinTty(false)` 覆写并在 finally 恢复，不要构造真实交互输入。
- 时间相关断言（`config set` 时间戳、`config publish` 默认标题）用正则或前后时间窗，不用精确值。

## 注意

- 非凭据的 CLI 变量（如 `APOLLO_PROFILE`）读取走 `src/store.js` 的 `getEnvVar`（process.env 优先，回退 config.json 的 `env` 段）；凭据解析在 `src/auth.js` 的 `resolveCredentials`（flags → shell/.env → config.json profile 字段 → config.json env 段），两条链的 shell/.env 优先于 config.json 的顺序须保持一致，新增来源时沿用该层级并补测试。
- 本地 `.env` 与 `apollo-cli.config.json` 含真实凭据且已 gitignore：绝不打印其内容或提交它们。
- 未经用户要求不要访问线上 Apollo Portal（登录、读写配置均有副作用）。
- 版本号唯一来源是 `src/version.js` 的 `VERSION`（`test/cli.test.js` 的 `--version` 断言会把它与 `package.json` 的 version 比对、拦住漂移）：一是 Node 21.x 与 22.0–22.11 上 `import ... with { type: 'json' }` 仍是实验特性，会往 stderr 打 ExperimentalWarning、污染 `--json` 模式下的错误输出；二是避免整份 package.json（含 devDependencies/scripts）被内联进打包产物，让升级 esbuild 这类改动也必须重新打包。发版时 `package.json` 与 `src/version.js` 两处都要改（测试会拦漂移）。
- `-h/--help` 与 `-V/--version` 在 `--` 之前的任意位置都生效（`apollo-cli config -V`、`apollo-cli --json config -h`、`apollo-cli config set -V` 均可用），可放在命令链任一层级；其余选项可放在子命令前或后，但写在子命令前时其后须紧跟子命令。改参数解析时保持该行为并补 `test/cli.test.js` 的位置矩阵用例。
- 需要 Node >= 21（用到 `getSetCookie()` 等新 API），不要写旧版本兼容代码。
- `src/store.js` 的原子写入带 Windows 杀软文件锁重试（EPERM/EACCES/EBUSY），改持久化逻辑时保留该行为。
- `src/output.js` 的表格按 CJK 双宽字符计算列宽，新增输出列时沿用此逻辑。
- 所有网络请求必须走 `src/http.js` 的 `fetchWithTimeout`（默认 30s 超时 + 统一连接错误文案），不要在业务代码里直接 `fetch`。
- 写命令（login/logout/setup/profile add|rm|default/config set|rm|publish）用 `src/commands.js` 的 `emit()` 保持双轨输出：`--json` 输出结构化结果（含 `needsPublish`/`releaseId` 等字段），否则输出中文文案；`config set/rm/publish` 保持 `--dry-run` 只读预演行为。新增写命令沿用此约定。
