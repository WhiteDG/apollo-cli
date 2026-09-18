---
name: apollo
description: 用本技能自带的 apollo-cli 命令行工具查看、修改、删除、发布 Apollo 配置中心的配置。当用户提到 Apollo、配置中心、命名空间、appId、发布配置、发布历史，或要查看/修改某个配置项（超时、开关、连接串、yml/yaml/json 文件里的字段等）时使用本技能。即使用户没有提到 apollo-cli 这个名字，只要意图是读写 Apollo 配置（如"把 fat 环境的 timeout 改成 5000"、"看下 app.yml 里的 server.port"、"发布一下配置"），都应使用本技能，而不是手写 HTTP 请求或让用户去 Portal 网页操作。
---

# apollo-cli 操作指南（CLI 随技能自带）

本技能自带 apollo-cli 命令行工具（`scripts/apollo-cli.cjs`）：机器上有 Node.js >= 21 即可直接运行，无需额外安装。它通过 Portal 账号密码登录（cookie 会话，过期自动重登），不需要 OpenAPI token。凡是读写 Apollo 配置的任务，一律用它完成，不要自己拼 Portal 的 HTTP 接口。

## 执行方式：先解析 <SK>

`<SK>` = 本次加载的 SKILL.md 所在目录的**绝对路径**。  解析一次后在本次会话内复用同一个值，之后所有命令统一为
`node "<SK>/scripts/apollo-cli.cjs" <命令> [选项]`（把 `<SK>` 换成解析出的绝对路径）。脚本路径必须加双引号：绝对路径可能含空格（如 Windows 用户名），不加引号会被 shell 拆成两段导致运行失败。

- **用绝对路径调用，且不要 `cd` 到 skill 目录**：profile 与凭据按当前工作目录解析（见下文"命令要在项目根目录执行"），命令必须留在项目根目录执行。

## 可用性检查

- 先解析 `<SK>`，再运行 `node "<SK>/scripts/apollo-cli.cjs" --version`：输出 `apollo-cli <版本号>` 即可用。报 `Cannot find module ...` 说明 `<SK>` 解析错了，回到上一步重新解析，不要改走手写 HTTP 请求等其他绕行方式。
- 报 `node: command not found`，或 `node --version` 低于 21 时，告知用户"运行本技能需要 Node.js >= 21，请先安装/升级 Node"，不要绕行。
- `node "<SK>/scripts/apollo-cli.cjs" profile list` 查看已配置的 profile、默认 profile、登录状态。用户说"fat 环境"就加 `-p fat`；没说时先确认默认 profile 是什么再动手。
- **命令要在项目根目录执行**：profile 定义来自 `~/.apollo-cli/config.json`（用户级）与当前目录的 `./apollo-cli.config.json`（项目级）合并（同名 profile 项目级整体替换用户级，不是字段合并），凭据可从 shell 环境变量、当前目录的 `.env`、或这两个 config.json 的 `env` 段 / profile 的 `username`/`password` 字段读取（shell 环境变量 > `.env` > config.json）。所以跑命令时留在含这两个文件的项目根目录；如果 profile 突然报"未配置"或凭据找不到，先检查当前目录是不是不在项目根（也可能是项目配置整体覆盖掉了用户配置里手写的凭据），不要急着删掉 profile 重建。
- 报"未找到凭据"时，提示用户配置 `APOLLO_<profile 名大写>_USERNAME/PASSWORD`（或全局 `APOLLO_USERNAME/PASSWORD`，写在 shell 环境、项目根目录 `.env` 或 config.json 里）后运行 `node "<SK>/scripts/apollo-cli.cjs" login <profile>`。不要替用户编造凭据，也不要去打印 `.env`、`~/.apollo-cli/session.json` 的内容。
- `profile list` 为空、或用户所说的环境没有对应 profile 时：说明需要先添加 profile（`profile add`，见下文"命令速查"），Portal 地址与内部环境名向用户询问，不要猜测；拿到地址后可以代跑（`profile add` 只写本地配置）；凭据按上一条配置后登录。

## 命令速查

下面 10 条常用命令的完整形式如下（`<SK>` 替换为解析出的绝对路径）：

```
node "<SK>/scripts/apollo-cli.cjs" login [profile]                  登录（通常不用手动跑，过期自动重登）
node "<SK>/scripts/apollo-cli.cjs" profile list                     列出 profile
node "<SK>/scripts/apollo-cli.cjs" profile add <name> --base-url <url> [--portal-env ENV] [--cluster CLUSTER] [--default]
node "<SK>/scripts/apollo-cli.cjs" ns ls <appId>                    列出命名空间（含格式 properties/yml/json）
node "<SK>/scripts/apollo-cli.cjs" config ls <appId> [-n ns]        列出配置项
node "<SK>/scripts/apollo-cli.cjs" config get <appId> <key> [-n ns] 获取单个配置项
node "<SK>/scripts/apollo-cli.cjs" config set <appId> <key> <value> [-n ns] [--comment 说明] [--string] [--dry-run]
node "<SK>/scripts/apollo-cli.cjs" config rm <appId> <key> [-n ns] [--yes] [--dry-run]
node "<SK>/scripts/apollo-cli.cjs" config publish <appId> [-n ns] [--title 标题] [--comment 说明] [--emergency] [--dry-run]
node "<SK>/scripts/apollo-cli.cjs" config releases <appId> [-n ns] [--limit n]
```

全局选项：`-p/--profile` profile、`--cluster` 集群、`-n/--namespace` 命名空间（默认 `application`）、`--json` 输出 JSON（读写命令都支持，需要解析输出或确认写结果时用）。全局选项放在子命令前或后都可以。

## 关键行为（容易踩坑的地方）

1. **set / rm 只改草稿，publish 才生效。** 修改后告知用户"需要 publish 才生效"并询问是否发布；用户一开始就说"改完发布"时才连着执行。用户问"为什么改了没生效"时，先 `config releases` 看最近一次发布时间是否早于修改时间。

2. **写操作影响的是共享的配置中心，先确认再执行。** 执行 set/rm/publish 前，核对 profile（`-p`）、appId、命名空间是否与用户意图一致；对生产类环境（prod/prd 等）的写操作和一切 `config rm`，必须先得到用户明确确认。需要先让用户看变更计划时，加 `--dry-run`（set/rm/publish 均支持）：会读取现状并输出计划，不做任何写入。`config rm` 在非交互终端必须带 `--yes`，否则会立即报错（不会挂起）。

3. **文件型命名空间（yml/yaml/json）的 key 是字段路径，不是配置项名。** 这类命名空间整份内容存在单个 `content` 配置项里，`config get/set` 的 key 按 `a.b[0].c` 路径解释（`-n app.yml`）。要点：
   - 含 `[` `]` 的路径一律加单引号（如 `'servers[0].host'`），防止 shell 按 glob 展开。
   - 查看整份文件内容用 `config ls <appId> -n app.yml --json`，不要 `config get <appId> content`（那表示取文档里名为 content 的字段）。
   - 标量替换保留原有注释和引号风格；把某字段整体替换成对象/数组时，该子树内的注释会丢失。

4. **`config set` 的值按单行 YAML 解析。** `5000` 存成数字、`true` 存成布尔、`{a: 1}` 存成结构。用户要存字面字符串时加 `--string`——典型场景：版本号 `1.20` 不加会变成数字 `1.2`（尾零丢失）。properties 命名空间下值本来就是字符串，不受影响。

## 典型流程

**改配置并发布：**
```bash
node "<SK>/scripts/apollo-cli.cjs" config get MyApp timeout -p fat   # 先看现值
node "<SK>/scripts/apollo-cli.cjs" config set MyApp timeout 5000 -p fat --comment "压测调大超时"
node "<SK>/scripts/apollo-cli.cjs" config publish MyApp -p fat --title "调大 timeout 至 5000"
```

**读写 yml 字段：**
```bash
node "<SK>/scripts/apollo-cli.cjs" config get MyApp server.port -n app.yml -p fat
node "<SK>/scripts/apollo-cli.cjs" config set MyApp feature.newCheckout true -n app.yml -p fat
```

**排查"配置没生效"：**
```bash
node "<SK>/scripts/apollo-cli.cjs" config ls MyApp -p fat            # 草稿里有没有这个 key、值对不对
node "<SK>/scripts/apollo-cli.cjs" config releases MyApp -p fat --limit 3   # 最近发布时间是否早于修改
```
