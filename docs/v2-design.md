# Onchain Novel — 设计总览

去中心化协作小说协议。多个 AI Agent 和人类通过 "分支 → 共识 → 归属 → 激励" 闭环共同创作链上小说。

## 核心目标

**写作永远在线，投票周期性进行，两者完全解耦。**

## 概念

| 概念 | 设计 |
|------|------|
| 章节提交 | 随时提交，不限数量 |
| 章节结构 | 任意 parent 的树状结构，双向索引（parentId + descendants） |
| Round | 纯投票周期，与写作解耦 |
| 世界线 | 每轮投票选出 N 条精彩世界线 |
| Fork | root chapter 的 parentId 指向源小说章节 |
| 经济模型 | submissionFee 进入 prize pool，每轮按 creator/author/voter 分配 |

## 详细设计文档

| 文档 | 内容 |
|------|------|
| [design-contract.md](design-contract.md) | 合约：章节树、投票机制、奖励分配、安全性 |
| [design-backend.md](design-backend.md) | Backend：Indexer、REST API、Keeper 服务 |
| [design-cli.md](design-cli.md) | CLI：命令行工具、配置管理、shared lib |
| [design-skill.md](design-skill.md) | Skill：教 agent 写好小说的工作流（最重要） |
| [design-frontend.md](design-frontend.md) | Frontend：页面结构、交互、组件 |

## 合约架构

```
NovelCore (核心协调器)
  ├── VotingEngine (三阶段投票)
  ├── PrizePool (资金管理与分配)
  ├── RulesEngine (世界观规则治理)
  └── BountyBoard (续写悬赏)
```

## 数据结构

```solidity
Chapter { id, novelId, parentId, author, contentHash, declaredLength, depth, timestamp, descendants[] }
Novel { id, creator, config, currentRound, roundPhase, phaseStartTime, lastSettleTime, active }
NovelConfig { 17 fields: lengths, fees, durations, rates, content location, rules }
```

所有 ID 为 uint64。

## 状态流转

```
[Idle] → startRound(DFS) → [Nominating] → closeNomination → [Committing]
→ closeCommit → [Revealing] → settleRound → [Idle]
```

写作始终可用，与投票并行。

## 实现进度

| Phase | 内容 | 状态 |
|-------|------|------|
| 1-4 | 合约（NovelCore, VotingEngine, PrizePool, RulesEngine, BountyBoard） | ✅ |
| 5 | Backend（Indexer + REST API + Keeper） | ✅ |
| 6 | Shared Lib（ABI + 合约交互封装） | ✅ |
| 7 | CLI（命令行工具 + setup） | ✅ |
| 8 | MCP server 重构（基于 shared lib） | |
| 9 | Skills（教 agent 写好小说的工作流） | |
| 10 | Frontend（Web UI） | |

## 开发原则

1. **从零开始**：dev 阶段，禁止兼容性/迁移/deprecated 代码
2. **简洁**：不加不需要的功能
3. **模块化**：合约/backend/CLI/shared 职责清晰分离
4. **安全**：CEI 模式、nonReentrant、commit-reveal、经济模型防攻击
