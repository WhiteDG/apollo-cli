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

## 作为 AI Skill 使用

本仓库自带一个 AI skill（`skills/apollo/`）：在支持 skills 的 AI 编程工具（如 Qoder、Claude Code）中安装后，可以用自然语言直接读写 Apollo 配置。skill 自带打包好的单文件 CLI 产物（`skills/apollo/scripts/apollo-cli.cjs`），**无需安装 apollo-cli**，机器上有 Node.js >= 21 即可。

### 安装 skill

```bash
# 用 skills CLI 安装（详见 npx skills --help）
npx skills add https://github.com/WhiteDG/apollo-cli --skill apollo
```

也可以手动安装：把 `skills/apollo/` 目录整个拷贝到所用工具的 skills 目录（如 `~/.qoder/skills/apollo/`）。

### 使用

安装后直接用自然语言提出需求，skill 会自动触发，例如：

- 「看下 fat 环境 MyApp 的 timeout 是多少」
- 「把 fat 环境 MyApp 的 timeout 改成 5000，改完发布」
- 「看下 MyApp 的 app.yml 里 server.port 是多少」

profile 与凭据跟 CLI 共用同一套配置（见「快速开始」的 1、2 步），首次使用前准备好即可。修改只写草稿、需要发布才生效；涉及生产类环境与删除操作时，skill 会先向你确认。

skill 内的完整使用说明见 `skills/apollo/SKILL.md`，行为测试用例见 `skills/apollo/evals/`。

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

profile 定义里还支持可选的手写字段：`username`/`password`（凭据，见「配置凭据」方式五）。`profile add` 只覆盖 `baseUrl`/`portalEnv`/`cluster`，手写字段会保留。

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

凭据还能直接写进 config.json（用户级 `~/.apollo-cli/config.json` 或项目级 `./apollo-cli.config.json`）：

```jsonc
// 方式四：env 段，语义与 .env 相同，任意 APOLLO_* 变量（含 APOLLO_PROFILE）都能在这里给值。
// 注意：这里的 env 指环境变量，与 profile 的 portalEnv（Apollo 环境名）无关。
{ "env": { "APOLLO_FAT_USERNAME": "myuser", "APOLLO_FAT_PASSWORD": "mypass" } }

// 方式五：profile 内直接写（只作用于该 profile；profile 里仍可继续手写其它字段）
{ "profiles": { "fat": { "baseUrl": "http://portal.example.com:8070", "username": "myuser", "password": "mypass" } } }
```

搜索顺序（高 → 低）：`--username/--password`（两者同时传入时优先）→ shell/.env 的 `APOLLO_<PROFILE>_USERNAME/PASSWORD` → shell/.env 的全局 `APOLLO_USERNAME/PASSWORD` → config.json profile 的 `username/password` 字段 → config.json `env` 段的 `APOLLO_<PROFILE>_USERNAME/PASSWORD` → config.json `env` 段的全局变量。即 shell 环境变量优先于 `.env`，两者都优先于 config.json；config.json 内 profile 字段优先于 `env` 段。只传 `--password`（不带 `--username`）时该 flag 会被忽略，继续按上述顺序回退。

> 安全提示：项目级 `apollo-cli.config.json` 常被提交到 git，不要把真实密码写进去；共享账号建议放用户级 `~/.apollo-cli/config.json` 或用 `.env`（记得 gitignore）。另外项目级与用户级出现**同名 profile** 时，项目级会整体替换用户级（不是字段合并），用户级手写的凭据会随之消失——凭据建议统一放用户级，或用 `env` 段（`env` 段按变量名合并，不会整体覆盖）。`profile add` 重跑时只覆盖 `baseUrl`/`portalEnv`/`cluster`，profile 里手写的 `username`/`password` 会保留。

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
| 用户配置 | `~/.apollo-cli/config.json` | profile 定义、默认 profile、`env` 段（APOLLO_* 变量值与凭据） |
| 会话 | `~/.apollo-cli/session.json` | 登录 cookie |
| 项目配置 | `./apollo-cli.config.json` | 项目级 profile 定义与 `env` 段；与用户配置合并，项目优先（同名 profile 整体替换，非字段合并） |

## 环境变量

| 变量 | 用途 |
|---|---|
| `APOLLO_PROFILE` | 默认 CLI profile 名 |
| `APOLLO_<PROFILE>_USERNAME` | profile 专属用户名 |
| `APOLLO_<PROFILE>_PASSWORD` | profile 专属密码 |
| `APOLLO_USERNAME` | 全局用户名（回退） |
| `APOLLO_PASSWORD` | 全局密码（回退） |

以上变量除 shell 环境与 `.env` 外，也可在 config.json 的 `env` 段中给出；优先级为 shell 环境变量 > `.env` > config.json。

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