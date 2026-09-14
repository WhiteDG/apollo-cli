# Apollo CLI

Apollo 配置中心命令行工具。通过 Portal 方式登录管理配置项，无需 OpenAPI Token。

## 环境要求

- Node.js >= 21（零依赖，仅用内置 fetch / parseArgs）

## 安装

```bash
npm link
# 或直接运行
node bin/apollo-cli.js --help
```

## 快速开始

### 1. 添加环境

```bash
apollo-cli env add fat --base-url http://portal.example.com:8070 --default
```

参数说明：
- `--base-url`：Portal 地址（必填）
- `--portal-env`：Apollo 内部环境名，不传则自动从环境名大写（fat → FAT）
- `--cluster`：集群名称，默认 `default`
- `--default`：设为默认环境

### 2. 配置凭据

创建 `.env` 文件或直接设置环境变量：

```bash
# 方式一：环境专属凭据（推荐多环境不同账号）
export APOLLO_FAT_USERNAME=myuser
export APOLLO_FAT_PASSWORD=mypass

# 方式二：全局凭据（所有环境共用）
export APOLLO_USERNAME=myuser
export APOLLO_PASSWORD=mypass

# 方式三：.env 文件（同样支持环境专属和全局）
APOLLO_FAT_USERNAME=myuser
APOLLO_FAT_PASSWORD=mypass
```

也可以复制模板快速开始：

```bash
cp .env.example .env   # 然后填入真实凭据
```

搜索顺序：`--username/--password`（两者同时传入时优先）→ `APOLLO_<ENV>_USERNAME/PASSWORD` → `APOLLO_USERNAME/PASSWORD`。shell 环境变量优先于 `.env` 文件。

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

## 配置存储

| 文件 | 位置 | 说明 |
|---|---|---|
| 用户配置 | `~/.apollo-cli/config.json` | 环境定义、默认环境 |
| 会话 | `~/.apollo-cli/session.json` | 登录 cookie |
| 项目配置 | `./apollo-cli.config.json` | 项目级环境定义，与用户配置合并 |

## 环境变量

| 变量 | 用途 |
|---|---|
| `APOLLO_ENV` | 默认 CLI 环境名 |
| `APOLLO_<ENV>_USERNAME` | 环境专属用户名 |
| `APOLLO_<ENV>_PASSWORD` | 环境专属密码 |
| `APOLLO_USERNAME` | 全局用户名（回退） |
| `APOLLO_PASSWORD` | 全局密码（回退） |

## 全局选项

| 选项 | 简写 | 说明 |
|---|---|---|
| `--env <name>` | `-e` | CLI 环境名（优先级高于 APOLLO_ENV） |
| `--cluster <name>` | | 集群名，默认读取环境配置的 cluster |
| `--namespace <name>` | `-n` | 命名空间，默认 "application" |
| `--json` | | JSON 格式输出 |

## 命令参考

```
apollo-cli login [env] [--username u] [--password p]
apollo-cli logout [env]
apollo-cli env list
apollo-cli env add <name> --base-url <url> [--portal-env ENV] [--cluster CLUSTER] [--default]
apollo-cli env rm <name>
apollo-cli env default <name>
apollo-cli ns ls <appId>
apollo-cli config ls <appId> [-n ns]
apollo-cli config get <appId> <key> [-n ns]
apollo-cli config set <appId> <key> <value> [-n ns] [--comment text]
apollo-cli config rm <appId> <key> [-n ns] [--yes]
apollo-cli config publish <appId> [-n ns] [--title t] [--comment c] [--emergency]
apollo-cli config releases <appId> [-n ns] [--limit n]
```