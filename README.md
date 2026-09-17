# Apollo CLI

Apollo 配置中心命令行工具。通过 Portal 方式登录管理配置项，无需 OpenAPI Token。

## 环境要求

- Node.js >= 21（运行时依赖仅 `yaml`，用于文件型命名空间字段读写）

## 安装

```bash
npm i -g github:WhiteDG/apollo-cli#master
# 或使用 pnpm
pnpm add -g github:WhiteDG/apollo-cli#master
```

安装 master 分支最新代码。升级：重跑同一条命令即可（每次安装都会重新拉取 master 最新提交）。如需固定版本，可将 `#master` 换成版本 tag（如 `#v0.1.0`）。

> 注意：不要用 `npm update -g apollo-cli` 升级。npm registry 上已存在同名包 `apollo-cli`（apollostack 的 GraphQL 工具），`npm update` 会按名字从 registry 解析，把它装进来顶替本工具。

### 从源码运行 / 开发

```bash
git clone https://github.com/WhiteDG/apollo-cli.git
cd apollo-cli
pnpm install        # 安装依赖
pnpm link --global  # 链接后可直接使用 apollo-cli
# 或直接运行
node bin/apollo-cli.js --help
```

## 快速开始

### 1. 添加 profile

profile 是「Portal 地址 + Apollo 环境 + 集群」的命名组合（类似 AWS CLI 的 profile）。

```bash
apollo-cli profile add fat --base-url http://portal.example.com:8070 --default
```

参数说明：
- `--base-url`：Portal 地址（必填）
- `--portal-env`：Apollo 内部环境名，不传则自动从 profile 名大写（fat → FAT）
- `--cluster`：集群名称，默认 `default`
- `--default`：设为默认 profile

### 2. 配置凭据

创建 `.env` 文件或直接设置环境变量：

```bash
# 方式一：profile 专属凭据（推荐多 profile 不同账号）
export APOLLO_FAT_USERNAME=myuser
export APOLLO_FAT_PASSWORD=mypass

# 方式二：全局凭据（所有 profile 共用）
export APOLLO_USERNAME=myuser
export APOLLO_PASSWORD=mypass

# 方式三：.env 文件（同样支持 profile 专属和全局）
APOLLO_FAT_USERNAME=myuser
APOLLO_FAT_PASSWORD=mypass
```

也可以复制模板快速开始：

```bash
cp .env.example .env   # 然后填入真实凭据
```

搜索顺序：`--username/--password`（两者同时传入时优先）→ `APOLLO_<PROFILE>_USERNAME/PASSWORD` → `APOLLO_USERNAME/PASSWORD`。shell 环境变量优先于 `.env` 文件。

### 3. 登录

```bash
apollo-cli login fat
```

登录成功后 cookie 保存在 `~/.apollo-cli/session.json`，会话过期时自动重新登录。

### 4. 管理配置

```bash
# 查看命名空间
apollo-cli ns ls MyApp

# 查看所有配置项
apollo-cli config ls MyApp

# 查看单个配置项
apollo-cli config get MyApp timeout

# 新增或更新（自动判断）
apollo-cli config set MyApp timeout 5000 --comment "5秒超时"

# 删除（交互确认，--yes 跳过）
apollo-cli config rm MyApp timeout --yes

# 发布
apollo-cli config publish MyApp --title "v2.3 发布"

# 发布历史
apollo-cli config releases MyApp --limit 5
```

### 5. 文件型命名空间（yml/yaml/json）字段读写

文件型命名空间在 Apollo 中整份内容存为单个 `content` 配置项。此时 `config get/set`
的 key 参数按**字段路径**解释（properties 命名空间行为不变）：

```bash
# 读取字段（标量原样输出；--json 输出 JSON 编码）
apollo-cli config get MyApp server.port -n app.yml
apollo-cli config get MyApp 'servers[0].host' -n app.yml --json

# 写入字段（值按单行 YAML 解析：123 → 数字、true → 布尔、{}/[] 或 a: b → 结构；含换行的值按原样字符串）
apollo-cli config set MyApp server.port 8080 -n app.yml
apollo-cli config set MyApp flags.enabled true -n app.yml

# 需要按字符串写入时加 --string（含 [] 的路径建议加引号，避免 zsh glob 报错）
apollo-cli config set MyApp 'server.ports[0]' 8080 -n app.yml --string
```

- 路径语法：`a.b[0].c`（`.` 分段；`[n]` 为数组下标，也可出现在最开头，如 `[0].a`）；下标只允许非负整数
- 限制：键名含 `.`/`[`/`]` 的字段无法寻址；不支持多文档 YAML（`---`）；数组起始下标不为 0 时无法新建数组；JSON 命名空间不支持写入 `__proto__` 键
- 保真：标量替换保留注释与引号风格（纯注释内容首次写入也不丢）；将某字段整体替换为对象/数组时，原子树内的注释会丢失
- 行尾与 BOM：原文有 BOM/CRLF 时写回还原；YAML 会补上缺失的结尾换行（JSON 按原文有无换行保持）
- 写入的是整份 `content`，与普通配置一样需 `config publish` 才会生效
- 查看整份文件内容用 `apollo-cli config ls MyApp -n app.yml --json`；注意文件模式下 `config get MyApp content` 是取文档中的 `content` 字段，不再是整份内容

## 配置存储

| 文件 | 位置 | 说明 |
|---|---|---|
| 用户配置 | `~/.apollo-cli/config.json` | profile 定义、默认 profile |
| 会话 | `~/.apollo-cli/session.json` | 登录 cookie |
| 项目配置 | `./apollo-cli.config.json` | 项目级 profile 定义，与用户配置合并 |

## 环境变量

| 变量 | 用途 |
|---|---|
| `APOLLO_PROFILE` | 默认 CLI profile 名 |
| `APOLLO_<PROFILE>_USERNAME` | profile 专属用户名 |
| `APOLLO_<PROFILE>_PASSWORD` | profile 专属密码 |
| `APOLLO_USERNAME` | 全局用户名（回退） |
| `APOLLO_PASSWORD` | 全局密码（回退） |

## 全局选项

全局选项可放在子命令前或子命令后（如 `apollo-cli --json config get MyApp timeout -p fat`）。

| 选项 | 简写 | 说明 |
|---|---|---|
| `--profile <name>` | `-p` | profile 名（优先级高于 APOLLO_PROFILE） |
| `--cluster <name>` | | 集群名，默认读取 profile 配置的 cluster |
| `--namespace <name>` | `-n` | 命名空间，默认 "application" |
| `--json` | | JSON 格式输出（读写命令均支持） |
| `--version` | `-V` | 显示版本号 |

## 自动化 / AI Agent 使用

- 退出码：成功为 0，失败为 1；错误信息统一写 stderr，stdout 只放业务输出，`--json` 时 stdout 是合法 JSON。
- 所有读写命令都支持 `--json`：读命令输出查询结果；写命令输出变更结果，如 `config set` 返回 `{action, key, namespace, value, needsPublish}`，`config publish` 返回 `releaseId`。
- 写命令（`config set/rm/publish`）支持 `--dry-run` 预演：读取现状并输出将要执行的变更计划，不做任何写入。
- 写操作只改草稿，需 `config publish` 才生效；`config set/rm` 的成功输出与 JSON 里的 `needsPublish` 都会提示这一点。
- 非交互环境（stdin 不是终端）下 `config rm` 未带 `--yes` 会立即报错，不会挂起等待输入；不支持通过管道喂 `y` 确认（如 `echo y | apollo-cli config rm ...`），脚本请显式使用 `--yes`。
- 网络请求默认 30s 超时，超时与连接失败都会给出明确报错。

## 命令参考

```
apollo-cli --version
apollo-cli login [profile] [--username u] [--password p]
apollo-cli logout [profile]
apollo-cli profile list
apollo-cli profile add <name> --base-url <url> [--portal-env ENV] [--cluster CLUSTER] [--default]
apollo-cli profile rm <name>
apollo-cli profile default <name>
apollo-cli ns ls <appId>
apollo-cli config ls <appId> [-n ns]
apollo-cli config get <appId> <key|path> [-n ns]
apollo-cli config set <appId> <key|path> <value> [-n ns] [--comment text] [--string] [--dry-run]
apollo-cli config rm <appId> <key> [-n ns] [--yes] [--dry-run]
apollo-cli config publish <appId> [-n ns] [--title t] [--comment c] [--emergency] [--dry-run]
apollo-cli config releases <appId> [-n ns] [--limit n]
```