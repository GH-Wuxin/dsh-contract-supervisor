# DeepSeek Harness Contract-First Supervisor / 基于合约优先的 DeepSeek Harness 监督器

**简体中文** | [English](README.md)

一个 DSH（DeepSeek Harness）插件包，以冻结的合约身份与确定性、仅追加（append-only）的状态来监督一次性代理（disposable-agent）流水线。

**状态：早期 Alpha —— MVP 完成中。**

尚不具备生产就绪性。

## 1. 这是什么

`dsh-contract-supervisor` 是一个实验性 DSH 插件（包名 `dsh-contract-supervisor`，`"private": true`——以源码发布为目的，不做 npm 发布）。它实现了一个小型、可审计的监督器，运行真实的 DSH 代理流水线：

- **Pro 指挥官**为单个切片（slice）生成建议性指令；
- **Flash 工作代理**恰好执行一次实现尝试（attempt）；
- 工作代理只能通过四个受审计的工具访问**切片作用域的（Slice-scoped）文件系统**；
- 每一步都对照**冻结的合约/切片身份**进行校验，并记录在**确定性、仅追加的状态**中。

本项目的核心在于边界：权威来自冻结的合约工件与可信的状态转换，绝不来自模型所写的内容。

## 2. 状态

- 早期 Alpha——MVP 完成中，尚未宣布完成。
- 首次付费的真实 Pro → Flash 自用（dogfood）运行仍待进行。
- 在密封检查点 C5.2 上，252 个确定性测试全部通过。
- 后续的验证器/审查器/密封/自托管工作可能仍未完成。
- 请勿将其视为生产级软件。

## 3. 为什么采用合约优先

- 代理是一次性的；经校验的状态是持久的。
- 工作代理报告 `PASS` 并不等于检查点 `PASS`。
- Pro 建议文本的权威增量为零。
- 权威来自冻结的合约/切片与监督器状态机，而非模型输出。
- 每次尝试（Attempt）都会生成全新的工作代理。
- 作用域强制采用失败关闭（fail closed）策略。

## 4. 架构

```
Human / RunSpec
  → host CLI (contract-supervisor-run)
  → fresh Pro commander (one turn, zero tools, advisory only)
  → deterministic Supervisor (frozen identities + append-only ledger)
  → fresh Flash worker (one Attempt per invocation)
  → Slice-scoped tools (slice_read / slice_search / slice_write / slice_edit)
```

指挥官的输出是建议性文本；监督器从冻结的合约/切片身份与受审计的工具面中派生权威。工作代理是真实的 `@deepseek-ai` DSH 代理，以单次一次性（one-shot）尝试配置，使用硬冻结的 `deepseek-ai/Flash` 模型，白名单仅限于受审计的文件系统工具。

## 5. 当前保障（密封检查点 C5.2）

以下内容均由 `tests/` 中的确定性测试覆盖：

- **冻结的合约/切片身份**：规范哈希与深度不可变性（`CONTRACT-*`、`SLICE-*`、`HASH-*`、`IMMUTABLE-*`）。
- **确定性准入**：拒绝作用域扩张与未知验证器引用（`AUTH-*`）。
- **确定性监督器状态机**：非法转换、尝试 ID 复用、以全新尝试重试、销毁屏障（`STATE-*`）。
- **仅追加的持久化 JSONL 账本**：支持篡改检测与撕裂尾部（torn-tail）恢复（`LEDGER-*`）。
- **工作代理生命周期**：每个工作代理仅运行一次、恰好销毁一次；每次尝试使用全新工作代理/会话；派生失败绝不伪造运行（`WORKER-*`）。
- **受审计的切片作用域文件系统访问**：恰好四个工具，权威在构造时冻结，违规即令尝试失效（`FS-*`）。
- **真实 DSH 插件集成**：真实的 Cordis 补丁、配置文件加载，并针对真实的 `@deepseek-ai/dsh-app-boot` 机制启动；加载时不派生任何工作代理（`INT-*` 及 `smoke:dsh` 脚本）。
- **宿主侧 `contract-supervisor-run` CLI**：单次启动驱动真实 DSH 编排（driver tier-1/2/3 测试）。
- **真实 Pro 指挥官编排**：零工具指挥官边界；每次调用一次 Flash 尝试；冻结的 `deepseek-ai/Pro` 指挥官与 `deepseek-ai/Flash` 工作代理（RunSpec 无法覆盖模型）。
- **密封检查点上的 252 个确定性测试**。

`lib/` 由 `npm run build` 从 `src/` 生成，作为密封源码发行版的一部分提交。

## 6. 当前局限

- MVP 尚未宣布完成。
- 首次付费的真实 Pro → Flash 自用运行仍待进行。
- 未达到生产就绪；除测试所证明的内容外，不提供任何安全或可靠性保证。
- 后续的验证器/审查器/密封/自托管工作可能仍未完成。
- 安装目前仍属开发者/内部用途：本包作为 DSH 配置捆绑（profile bundle）插件从本地检出加载。干净公开的安装流程尚未建立。
- `contract-supervisor-run` CLI 需要 DSH 配置/启动器上下文，属于开发者接缝，而非面向模型使用的工具。

## 7. 开发与验证

要求：Node.js 24+、npm 11+。所有依赖均从公共 npm 注册表安装（`npm ci` 可通过 `package-lock.json` 复现）。

```sh
npm ci
npm run typecheck
npm test
npm run smoke:dsh
npm run build
```

- `npm test` —— 确定性测试套件（C5.2 上 252 个测试）。
- `npm run smoke:dsh` —— 真实 DSH 配置/捆绑加载冒烟测试。它会在仓库之外创建临时 `$DSH_HOME`，通过真实的 DSH 配置机制加载本包，并验证插件能够激活并提供其服务接缝。该测试不需要任何 API 密钥，也不会产生任何付费 API 调用。

## 8. 项目状态与路线图

- 早期 Alpha——MVP 完成中（当前阶段）。
- 在未来的检查点宣布 MVP 完成。
- 首次付费的真实 Pro → Flash 自用运行。
- 验证器/审查器/密封机制，随后自托管。

路线图属愿景性质；除当前检查点之外，不作任何承诺。

## 9. 许可证

本项目采用**仅 GNU 通用公共许可证第 3 版**（SPDX：`GPL-3.0-only`）。完整许可证文本见 `LICENSE` 文件。