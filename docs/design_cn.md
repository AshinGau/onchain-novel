## 设计文档：去中心化协作式小说协议

本文档描述协议的技术架构与设计决策。需求详见 [requirements.md](./requirements.md)，经济模型详见 [economic_model.md](./economic_model.md)。

---

### 1. 术语表

| 术语 | 定义 |
|------|------|
| **Novel** | 一个独立的协作创作项目，由创世者发起 |
| **Chapter** | 一次续写提交的内容单元 |
| **Candidate** | 某一轮中提交的候选续写，以 ID 标识（如 Candidate(ID.5)） |
| **World Line（世界线）** | 经过 Round 投票后保留的分支 |
| **Canon（正统主线）** | 经过 Epoch 投票后确立的唯一故事线 |
| **Round（轮次）** | "续写 → 投票 → 世界线收束"的完整周期 |
| **Epoch（纪元）** | 若干 Round 后的终极投票与结算周期 |
| **Fork（分叉）** | 基于落选分支发起的全新独立小说 |

---

### 2. 合约架构

```
┌─────────────────────────────────────────────────────┐
│                    UUPS Proxy Layer                  │
├──────────┬──────────────┬───────────┬────────────────┤
│NovelCore │ VotingEngine │ PrizePool │  ChapterNFT    │
│状态机     │ Commit-Reveal│ 奖金管理   │  ERC-721       │
│章节树     │ Stake-to-Vote│ 打赏 & 分配│  版权 NFT      │
│协调中枢   │ 投票引擎      │ Pull 领取  │  元数据管理     │
└──────────┴──────────────┴───────────┴────────────────┘
```

| 合约 | 职责 |
|------|------|
| **NovelCore** | 小说创建、章节提交、Round/Epoch 状态机、保证金管理、污染追踪、Keeper 奖励、提前 Epoch 触发 |
| **VotingEngine** | Commit-Reveal Stake-to-Vote、计票排名、未揭示质押扫荡、准确性奖励追踪与分发 |
| **PrizePool** | 创世注入、读者打赏、三层 Epoch 分配（创世者→作者→投票者）、Keeper 奖励、Pull 领取 |
| **ChapterNFT** | ERC-721 铸造、章节版权证明、ERC-2981 版税、元数据查询 |

---

### 3. 状态机

#### 3.1 Round 生命周期

```
Submitting ──[closeSubmissions]──→ Committing ──[endCommitPhase]──→ Revealing ──[settleRound]──→ Submitting (next round)
```

- **Submitting**：作者提交续写章节，附带保证金
- **Committing**：投票者提交 `hash(candidateId, salt)`，附带质押 ETH
- **Revealing**：投票者揭示投票，合约验证哈希
- **Settling**：计票，得票最高 N 条成为世界线，更新污染记录

触发条件：`closeSubmissions` 需 Round 最短时间到期 **且** 提交数达标（`≥ roundMinSubmissions`）。

#### 3.2 Epoch 生命周期

```
Rounds ──[K 轮后]──→ Committing ──→ Revealing ──[settleEpoch]──→ Rounds (next epoch)
```

Epoch 投票复用同一 Commit-Reveal 流程，候选对象为 N 条活跃世界线。

结算动作：
1. 选出 Canon 世界线
2. 铸造 Canon 章节的 ERC-721 NFT（仅当前 Epoch 章节）
3. 分配 Epoch 奖金（详见 economic_model.md）
4. 返还保证金 / 执行污染罚没
5. Canon 为起点开启新 Epoch

---

### 4. 内容存储

小说创建时选择内容存储模式（不可变）：

| 模式 | 链上数据 | 内容获取方式 |
|------|---------|------------|
| **Onchain** | calldata 包含完整内容 | Indexer 从交易 calldata 解码 |
| **External** | 仅 contentHash | Indexer 从 `contentBaseUrl + hash` 拉取 |
| **HTTP** | 仅 contentHash | Indexer 从 `contentBaseUrl + hash` 拉取 |

推荐 Onchain 模式：L2 上 10KB calldata 约 $0.01-0.05，零外部依赖。

---

### 5. Web 系统架构

```
┌────────────────────────────────────────────────┐
│                   Frontend                      │
│          Next.js + wagmi + viem                 │
│   (SSR 阅读页, CSR 钱包交互页)                    │
└──────────────┬─────────────┬───────────────────┘
               │ REST        │ RPC (钱包签名)
               ▼             ▼
┌──────────────────┐  ┌──────────────┐
│   Backend API    │  │  EVM Chain   │
│  (Node.js)       │  │  (Contracts) │
│  - REST API      │  └──────┬───────┘
│  - Event Indexer │◄────────┘ Events
└───────┬──────────┘
        ▼
┌──────────────┐
│  PostgreSQL  │
└──────────────┘
```

#### 5.1 Event Indexer

核心职责：监听链上事件，构建链下索引。

设计要点：
- **分批拉取**：可配置 batchSize，每批完成后更新 `indexer_state.last_block`
- **失败重试**：指数退避，区分 Rate Limit / Range Too Wide / 网络错误
- **事务一致性**：每批事件在同一 DB 事务中处理，失败则全部回滚
- **内容解码**：Onchain 模式下从交易 calldata 解码内容（`decodeFunctionData`），External/HTTP 模式下异步从 URL 拉取
- **多 RPC 容错**：主节点失败时自动切换备用节点

#### 5.2 前端设计

- 无钱包状态：SSR 渲染阅读页，SEO 友好
- 钱包交互：wagmi/viem 直接调用合约
- 所有写操作直接与链交互，后端仅提供索引数据查询
- 投票 salt 持久化到 localStorage

---

### 6. 安全设计

#### 6.1 合约安全

- ReentrancyGuard 防重入、CEI 模式、Solidity ≥ 0.8.x 溢出保护
- Ownable 访问控制、Pausable 紧急暂停
- UUPS Proxy 升级需 `onlyOwner`（应转移至多签 + TimelockController）
- 所有 ETH 转账使用 Pull 模式（`claimReward` / `claimStakeRefund`）

#### 6.2 投票安全

- Commit-Reveal 防止抢先交易和跟风投票
- Stake-to-Vote：质押量 = 投票权重
- 未 Reveal 质押没收分给已 Reveal 投票者

#### 6.3 内容安全

- 协议层不做内容审查
- `ReportRegistry` 接口预留举报/仲裁功能
- 内容审核由前端自行决定

---

### 7. 升级策略

- 4 个合约均使用 UUPS Proxy 模式部署
- 每个合约预留 `__gap`（50 storage slots）
- `_authorizeUpgrade()` 由 `onlyOwner` 保护
- 新功能作为独立合约或新参数添加，不改变已有存储布局
