# apollo skill

在支持 skills 的 AI 工具里查看、修改、删除、发布 Apollo 配置中心的配置。

## 安装

- 前提：运行环境有 Node.js >= 21。
- 可以用 skills CLI 安装：`npx skills add https://github.com/WhiteDG/apollo-cli --skill apollo`；也可以手动把本目录整个拷贝到所用工具的 skills 目录（如 `~/.qoder/skills/apollo/`）。
- 首次使用让 AI 带跑一条 `setup` 命令即可完成配置与登录验证（见 `SKILL.md` 的「首次配置」一节）。

## 配置存放位置

- profile 与凭据：用户级 `~/.apollo-cli/config.json`（`setup` 写入此处）；当前目录的 `apollo-cli.config.json` 与 `.env` 也会参与解析。
- 登录会话：`~/.apollo-cli/session.json`，会话过期自动重登。

凭据来源与优先级的完整说明见 `SKILL.md`。
