# apollo skill 测试用例（evals）

`evals.json` 里是给本技能做行为测试的用例：每条 = 一个真实用户口吻的 prompt + 一组可客观核对的断言，断言覆盖用到的命令、最终答案与副作用边界。

## 运行前的前置条件（fixture）

这些用例依赖一台**测试用** Apollo Portal 的固定数据，运行前请确认：

- 已配置 `dev` profile（指向测试 Portal、凭据可用）；`staging` profile **故意不配置**——`unconfigured-profile` 用例专门测这个错误路径。
- 测试应用 `demo-app`（dev 环境）包含：
  - `application` 命名空间：`server.port = 8080`；`logging.web.enabled` 为布尔配置项（供写入用例）；`app.env`（供删除用例）。
  - `cache.yaml` 文件型命名空间：`cache.specs.redisson` 列表首条规则 `expires = P7D`，且含多条缓存规则；`cache.version` 不存在（供新增用例）。
- 断言里的具体值（8080、P7D）以 fixture 数据为准；换环境要同步更新 `evals.json`。
- 绝不要在真实生产 Portal 上跑本套用例。

## 演练模式约定（关键）

所有涉及写操作的用例（id 3/4/5/6/8）都标了"演练模式：写命令只输出计划，不真实执行"。给被测 agent 的任务描述里必须带上这条约定，并明确要求它：

- 只读命令（config get / config ls / config releases / profile list 等）**真实执行**；
- 一切写命令（config set/rm/publish、login、profile * 等）**不执行**，只在最终答复里给出命令计划；
- 把真实执行过的每条命令及其输出按顺序写入 `commands.log`；
- 把最终答复（含计划中的写命令）写入 `result.md`。

`commands.log` 与 `result.md` 是若干断言的核对依据（如"写命令有没有被真实执行"），务必要求 agent 产出这两个文件；不产出则这类断言无法判定。

## 建议的运行方式

每条 prompt 跑两组对照：带本技能（with_skill，agent 可读到本目录的 `SKILL.md`）与不带（without_skill，纯基线），输出分别保存后对照断言通过情况与副作用边界。新增用例时沿用现有格式：id 递增、name 用小写短横线、prompt 用真实用户口吻、断言写成可客观核对的陈述句。
