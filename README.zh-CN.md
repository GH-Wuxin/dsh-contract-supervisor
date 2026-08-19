# DeepSeek Harness Contract-First Supervisor

**简体中文** | [English](README.md)

**一个给 DeepSeek Harness 用的 Contract-First Supervisor。**

Pro 负责分析并提出执行建议，Flash 负责具体修改，但两者都不能自行决定或扩大权限。

文件访问范围来自冻结的 Contract / Slice；模型选择和运行策略由可信的宿主配置固定。真正执行这些边界的是确定性的 Supervisor。

**状态：Early Alpha，MVP 收尾中。**

## 为什么做这个

很多 Agent 系统让模型决定“接下来做什么”的同时，也给了它很宽、甚至能被模型间接影响的执行权限。本项目要做的就是把这两件事拆开。

```text
Pro 提建议
    ↓ 只有建议权
Supervisor 掌握 authority
    ↓ 冻结的权限策略
Flash 执行
    ↓ Slice 范围内的工具
```

模型可以提出操作建议，但不能给自己增加工具、扩大文件访问范围、修改 Worker 配置，或者创造新的权限路径。

## 怎么工作

一次运行从 Human / RunSpec 开始，路径固定不变：

```text
Human / RunSpec
  → 宿主 CLI（contract-supervisor-run）
  → Pro 指挥官：一条建议性指令，零工具
  → 确定性 Supervisor：对照冻结的 Contract / Slice 做准入校验
  → Flash 工作代理：恰好执行一次实现尝试（Attempt）
  → Slice 范围内的工具：slice_read / slice_search / slice_write / slice_edit
```

- **Pro** 是指挥官：单轮建议、零工具，输出只是建议，不是命令。
- **Supervisor** 把每一步都对照冻结的 Contract / Slice 身份校验，并把结果记录到确定性、仅追加的状态里。
- **Flash** 是一次性 Worker：每次尝试只有一次 Attempt、Slice 范围内的工具和硬冻结的模型选择。

集成与编排测试跑在 genuine DSH runtime 上，模型响应由 scripted LLM adapter 提供；首次 live DeepSeek API 付费运行仍在计划中。

## 现在做到哪

以下能力都有测试覆盖：

- 冻结的 Contract / Slice 身份：规范哈希、深度不可变。
- 确定性准入：作用域扩张、未知验证器引用一律拒绝。
- 确定性 Supervisor 状态机：非法转换和 Attempt ID 复用被拒绝，重试总是拿到全新 Attempt。
- 仅追加的持久化 JSONL 账本，带篡改检测。
- 一次性 Worker 生命周期：一次运行、一次销毁、不伪造运行。
- 受审计的 Slice 文件系统访问：四个受审计工具，fail-closed。
- 真实 DSH 插件集成：真实 Cordis 补丁、配置加载与启动，以及宿主侧 `contract-supervisor-run` CLI。
- Pro → Supervisor → Flash 编排（scripted LLM adapter）。
- 当前公开修订版上 252 个确定性测试全部通过，Linux GitHub Actions CI（typecheck / tests / smoke）通过。

## Authority 模型

四条规则，没有例外：

- 模型不负责定义权限。
- Pro 没有工具，输出只有建议权。
- Flash 只拿到 Slice 派生出来的工具和文件范围。
- 状态无效或不确定时 fail-closed，绝不部分授权。

## 开发与验证

要求：Node.js 24+、npm 11+。

```sh
npm ci
npm run typecheck
npm test
npm run smoke:dsh
npm run build
```

- `npm test` —— 确定性测试套件（252 个测试）。
- `npm run smoke:dsh` —— 在仓库外创建临时 `$DSH_HOME`，通过真实 DSH 配置机制加载本包；不需要 API 密钥，不产生付费调用。

## 当前限制

- Early Alpha，MVP 尚未宣布完成。
- 首次 live 付费 Pro → Flash dogfood 运行尚未进行。
- 安装方式目前只面向开发者：从本地检出以 DSH profile bundle 加载，干净公开的安装流程还没建立。
- 验证器 / 审查器 / 密封 / 自托管相关工作尚未完成。

## 路线图

1. live Pro → Flash dogfood 运行。
2. 完成 MVP。
3. 第一个自托管维护 Slice。
4. 宣布 MVP 完成。
5. MVP 之后的验证器 / 审查器 / 密封扩展。

## 许可证

仅 GNU 通用公共许可证第 3 版（SPDX：`GPL-3.0-only`），完整文本见 `LICENSE` 文件。