# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

## 命令

- 直接运行：`node bin/apollo-cli.js --help`（或 `pnpm link --global` 后用 `apollo-cli`）。
- 依赖安装：`pnpm install`（包管理器用 pnpm，lock 文件为 `pnpm-lock.yaml`）。
- 测试：`pnpm test`（即 `node --test "test/**/*.test.js"`）；单文件 `node --test test/store.test.js`；调试单文件可直接 `node test/store.test.js`（TAP 直出）。不要用 `node --test test/`，目录参数会被当成文件报错。
- 无 lint、格式化配置。快速静态检查用 `node --check <file>`，再人工审查代码。

## 语言

- 用户可见字符串（帮助、错误信息、表头）、代码注释、commit message 一律用中文。
- commit 格式：`type: 中文描述`，如 `feat: 新增 Apollo 配置中心 CLI 工具`。

## 依赖

- 运行时依赖仅 `yaml@^2`（eemeli/yaml，零传递依赖）：用于 yml/yaml 命名空间的解析与保注释回写（`src/filecontent.js`）；JSON 用内置 `JSON.parse/stringify`。
- 包管理器用 pnpm；`pnpm-lock.yaml` 需提交。除此之外仅用 Node 内置模块，新增依赖需说明理由。

## 代码风格

- ESM（`"type": "module"`），相对导入必须写 `.js` 扩展名。
- 2 空格缩进、单引号、具名导出。
- 错误处理：`die()`/`fatal()` 抛 Error，由 `src/cli.js` 的 `run()` 统一捕获并置 exitCode=1；`HelpExit` 用于打印帮助后退出，不要捕获吞掉它。

## 测试

- 测试工具只用 Node 内置 `node:test` + `node:assert/strict`。测试放 `test/`，命名 `*.test.js`；`test/helpers.js` 是共享工具（顶层零副作用、不 import src）。
- `test/filecontent.test.js` 为纯函数测试（无需 `setupIsolatedHome()`/fetch 桩）；其余文件按隔离纪律执行。
- 隔离纪律（`src/store.js` 在模块加载期冻结 `~/.apollo-cli` 路径）：需要 store 的测试文件必须在**动态 `import()` src 之前**完成：`mkdtemp` → 设 `USERPROFILE`（Windows 上 `HOME` 无效，一并设置无害）→ `chdir` 临时目录 → 清空 `APOLLO_*`。用 `setupIsolatedHome()`，并用 `assertIsolated()` 兜底断言。
- 测试绝不读取仓库真实 `.env` 与 `apollo-cli.config.json`，fetch 一律用 `t.mock.method(globalThis, 'fetch', ...)` 打桩，不访问网络。
- 捕获 stdout/stderr 必须转发到原函数（测试 runner 用子进程 stdout 传协议，只记录不转发会整轮卡死）；禁止用 `t.mock` 打桩 stdio。
- `run()` 测试包装器必须在 finally 复位 `process.argv`/`process.exitCode`（残留 1 会让整个文件判失败）。
- 不要测 `config rm` 无 `--yes` 的交互分支（stdin 是管道会永久挂起）。
- 时间相关断言（`config set` 时间戳、`config publish` 默认标题）用正则或前后时间窗，不用精确值。

## 注意

- 本地 `.env` 与 `apollo-cli.config.json` 含真实凭据且已 gitignore：绝不打印其内容或提交它们。
- 未经用户要求不要访问线上 Apollo Portal（登录、读写配置均有副作用）。
- 需要 Node >= 21（用到 `getSetCookie()` 等新 API），不要写旧版本兼容代码。
- `src/store.js` 的原子写入带 Windows 杀软文件锁重试（EPERM/EACCES/EBUSY），改持久化逻辑时保留该行为。
- `src/output.js` 的表格按 CJK 双宽字符计算列宽，新增输出列时沿用此逻辑。
