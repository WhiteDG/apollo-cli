# apollo skill

在支持 skills 的 AI 工具（如 Qoder）里查看、修改、删除、发布 Apollo 配置中心的配置。

## 安装

- 前提：机器上有 Node.js >= 21。**不需要**安装 apollo-cli——本 skill 自带打包好的单文件 CLI（`scripts/apollo-cli.cjs`）。
- 把本目录（`skills/apollo`）整个拷贝到 `~/.qoder/skills/apollo/` 即可；也可用 skill 管理 CLI 从本仓库安装（如 `npx skills add`，能否识别本目录以工具实际行为为准）。
