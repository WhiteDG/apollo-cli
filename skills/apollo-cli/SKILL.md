---
name: apollo-cli
description: 用 apollo-cli 命令行工具查看、修改、删除、发布 Apollo 配置中心的配置。当用户提到 Apollo、配置中心、命名空间、appId、发布配置、发布历史，或要查看/修改某个配置项（超时、开关、连接串、yml/yaml/json 文件里的字段等）时使用本技能。即使用户没有提到 apollo-cli 这个名字，只要意图是读写 Apollo 配置（如"把 fat 环境的 timeout 改成 5000"、"看下 app.yml 里的 server.port"、"发布一下配置"），都应使用本技能，而不是手写 HTTP 请求或让用户去 Portal 网页操作。
---

# apollo-cli 操作指南

apollo-cli 是本机全局安装的 Apollo 配置中心 CLI（`npm install -g apollo-cli` 分发，需要 Node.js >= 21），通过 Portal 账号密码登录（cookie 会话，过期自动重登），不需要 OpenAPI token。凡是读写 Apollo 配置的任务，一律用它完成，不要自己拼 Portal 的 HTTP 接口。

## 可用性检查

- 直接运行 `apollo-cli <命令>`。若提示命令不存在，说明没装，告知用户运行 `npm install -g apollo-cli` 安装后再试，不要尝试其他绕行方式。
- `apollo-cli env list` 查看已配置的环境、默认环境、登录状态。用户说"fat 环境"就加 `-e fat`；没说环境时先确认默认环境是什么再动手。
- **命令要在项目根目录执行**：环境定义来自 `~/.apollo-cli/config.json`（用户级）与当前目录的 `./apollo-cli.config.json`（项目级）合并，凭据也从当前目录的 `.env` 读取。所以跑命令时留在含这两个文件的项目根目录；如果环境突然报"未配置"或凭据找不到，先检查当前目录是不是不在项目根，不要急着删掉环境重建。
- 报"未找到凭据"时，提示用户配置 `APOLLO_<环境名大写>_USERNAME/PASSWORD`（或全局 `APOLLO_USERNAME/PASSWORD`，写在 shell 环境或项目根目录 `.env` 里）后运行 `apollo-cli login <env>`。不要替用户编造凭据，也不要去打印 `.env`、`~/.apollo-cli/session.json` 的内容。

## 命令速查

```
apollo-cli login [env]                      登录（通常不用手动跑，过期自动重登）
apollo-cli env list                         列出环境
apollo-cli ns ls <appId>                    列出命名空间（含格式 properties/yml/json）
apollo-cli config ls <appId> [-n ns]        列出配置项
apollo-cli config get <appId> <key> [-n ns] 获取单个配置项
apollo-cli config set <appId> <key> <value> [-n ns] [--comment 说明] [--string] [--dry-run]
apollo-cli config rm <appId> <key> [-n ns] [--yes] [--dry-run]
apollo-cli config publish <appId> [-n ns] [--title 标题] [--comment 说明] [--emergency] [--dry-run]
apollo-cli config releases <appId> [-n ns] [--limit n]
```

全局选项：`-e/--env` 环境、`--cluster` 集群、`-n/--namespace` 命名空间（默认 `application`）、`--json` 输出 JSON（读写命令都支持，需要解析输出或确认写结果时用）。全局选项放在子命令前或后都可以。

## 关键行为（容易踩坑的地方）

1. **set / rm 只改草稿，publish 才生效。** 修改后告知用户"需要 publish 才生效"并询问是否发布；用户一开始就说"改完发布"时才连着执行。用户问"为什么改了没生效"时，先 `config releases` 看最近一次发布时间是否早于修改时间。

2. **写操作影响的是共享的配置中心，先确认再执行。** 执行 set/rm/publish 前，核对环境（`-e`）、appId、命名空间是否与用户意图一致；对生产类环境（prod/prd 等）的写操作和一切 `config rm`，必须先得到用户明确确认。需要先让用户看变更计划时，加 `--dry-run`（set/rm/publish 均支持）：会读取现状并输出计划，不做任何写入。`config rm` 在非交互终端必须带 `--yes`，否则会立即报错（不会挂起）。

3. **文件型命名空间（yml/yaml/json）的 key 是字段路径，不是配置项名。** 这类命名空间整份内容存在单个 `content` 配置项里，`config get/set` 的 key 按 `a.b[0].c` 路径解释（`-n app.yml`）。要点：
   - 含 `[` `]` 的路径一律加单引号（如 `'servers[0].host'`），防止 shell 按 glob 展开。
   - 查看整份文件内容用 `config ls <appId> -n app.yml --json`，不要 `config get <appId> content`（那表示取文档里名为 content 的字段）。
   - 标量替换保留原有注释和引号风格；把某字段整体替换成对象/数组时，该子树内的注释会丢失。

4. **`config set` 的值按单行 YAML 解析。** `5000` 存成数字、`true` 存成布尔、`{a: 1}` 存成结构。用户要存字面字符串时加 `--string`——典型场景：版本号 `1.20` 不加会变成数字 `1.2`（尾零丢失）。properties 命名空间下值本来就是字符串，不受影响。

## 典型流程

**改配置并发布：**
```bash
apollo-cli config get MyApp timeout -e fat                    # 先看现值
apollo-cli config set MyApp timeout 5000 -e fat --comment "压测调大超时"
apollo-cli config publish MyApp -e fat --title "调大 timeout 至 5000"
```

**读写 yml 字段：**
```bash
apollo-cli config get MyApp server.port -n app.yml -e fat
apollo-cli config set MyApp feature.newCheckout true -n app.yml -e fat
```

**排查"配置没生效"：**
```bash
apollo-cli config ls MyApp -e fat            # 草稿里有没有这个 key、值对不对
apollo-cli config releases MyApp -e fat --limit 3   # 最近发布时间是否早于修改
```
