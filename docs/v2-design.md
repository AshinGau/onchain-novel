# Onchain Novel V2 — 设计方案

## 1. 设计目标

V1 的核心痛点：
- 进入 commit-reveal 阶段后无法提交 chapter，写作和投票强耦合
- 每轮 round 只能提交一章，创作受限
- bootstrap / epoch / round 三层概念过于复杂
- NFT 功能增加复杂性但实际用不上

V2 目标：**写作永远在线，投票周期性进行，两者完全解耦。**

---

## 2. 核心概念变更

| 概念 | V1 | V2 |
|------|----|----|
| 章节提交 | 仅在 Submitting 阶段，每轮一章 | **随时提交，不限数量** |
| 章节结构 | 基于 active world lines 的线性分支 | **任意 parent 的树状结构，双向索引** |
| Bootstrap | 特殊的创世章节，有独立逻辑 | **移除，creator 提交普通 chapter 作为 root** |
| Round | 提交+投票的复合周期 | **纯投票周期，与写作解耦** |
| Epoch | K 轮 round 后的 canon 投票 | **移除，只有 round** |
| 世界线 | Epoch 投票选出 canon | **每轮投票选出 N 条精彩世界线** |
| NFT | Canon chapter 铸造 NFT | **移除** |
| Spam 机制 | 连续低排名 → slash stake | **移除，改为提交付费** |
| Fork creator | 原小说 creator | **Fork 发起人** |

---

## 3. 章节树 (Chapter Tree)

### 3.1 数据结构

```solidity
struct Chapter {
    uint64 id;              // 全局唯一 ID
    uint64 novelId;
    uint64 parentId;        // 0 = 原创小说的 root; 跨小说 ID = fork root; 本小说 ID = 续写
    address author;
    bytes32 contentHash;
    uint64 declaredLength;
    uint32 depth;           // 本小说内的树深度，root = 1
    uint64 timestamp;
    uint64[] descendants;   // 子章节 ID 列表（双向索引）
}
```

**使用 uint64 做 ID**：2^64 足够覆盖所有 chapter/novel，struct packing 显著减少 storage slot 消耗。

**双向索引**：`parentId` 向上遍历，`descendants` 向下遍历。向下遍历使得 `startRound` 时可以从世界线分叉点 DFS 找到最深的 M 条链，无需在提交时维护额外的候选池。

### 3.2 提交规则

- **随时可提交**，不受投票阶段影响
- 任意已有 chapter 都可作为 parent（包括不在世界线上的）
- 提交时支付 `submissionFee`（不可退还），直接进入 prize pool
- 同一作者可提交多章，不限频率（fee 本身就是防 spam）
- Root chapter（depth = 1）只能由 creator 在 `createNovel` / `forkNovel` 时提交，有且仅有一章
- 提交时自动 `chapters[parentId].descendants.push(chapter.id)`，O(1)

### 3.3 链 (Chain) 的定义

一条 **chain** 是从 root 到某个 chapter 的完整路径。chain 由其末端 chapter ID 唯一标识。

```
root(1) → ch(2) → ch(4) → ch(7)    ← chain 7
              └→ ch(5) → ch(8)      ← chain 8
         └→ ch(3) → ch(6)           ← chain 6
```

**投票是对某个 chapterId 投票**，不存在"leaf chapter"的概念——因为投票期间写作仍在继续，任何 chapter 随时可能有新的后继。

### 3.4 Fork — 通过 Root Chapter 的 parentId 统一标识

**核心设计：Fork 小说的 root chapter 的 `parentId` 指向源小说的分叉章节（跨小说引用）。**

判断小说类型：
- **原创小说**：root chapter 的 `parentId = 0`，`depth = 1`
- **Fork 小说**：root chapter 的 `parentId != 0 && depth == 1`

仅用 chapter 自身字段即可判断，无需额外 SLOAD。

不需要在 Novel 结构体上存 `forkSourceNovelId` / `forkSourceChapterId`，这些信息从 root chapter 推导：
```solidity
// 获取 fork 源信息
Chapter storage root = chapters[novelRootId[novelId]];
if (root.parentId != 0) {
    // root.parentId  = 源章节 ID
    // chapters[root.parentId].novelId = 源小说 ID（需要时再读取）
}
```

**树遍历规则**：遍历本小说章节树时，遇到 `depth == 1` 即为 root 边界，停止向上遍历。

Fork 的其他规则：
- Fork 发起人成为新小说的 **creator**
- Fork root 是 forker 提交的**全新内容**（不复制源章节内容），`parentId` 指向源章节仅作为来源标识
- 支付 fork fee = `max(submissionFee, sourcePoolBalance * forkFeeRate / 10000)`，进入**源小说**的 prize pool。`forkFeeRate` 为合约级别常量，成功小说的 fork 成本与其价值成正比
- 新小说的 config 可自由设定（`contentLocation` 继承源小说）

---

## 4. 投票机制

### 4.1 候选集的必要性

用户不能对任意 chapterId 投票，必须有固定的候选集。原因：**投票分裂问题**。

例如两条故事线 `C1←C2←C3` 和 `C1←A1←A2`，三票分别投 C2(权重1)、C3(权重1)、A2(权重1.1)。如果允许对任意 chapter 投票，A2 以 1.1 胜出。但 C2 和 C3 在同一条链上，合并后权重为 2，理应胜出。

**候选集确保每条链只有一个代表（该链最深的 chapter），投票不会分裂。**

### 4.2 候选集的产生 — 从世界线分叉点 DFS

利用 chapter 的 `descendants` 双向索引，`startRound` 时从每个世界线分叉点（worldLineAncestors）做 DFS，找到最深的 M = 3*N 条链（N 为 `worldLineCount`，creator 设置）。

```solidity
// worldLineAncestors: 上轮投票胜出的 N 个 chapterId（分叉点）
// startRound 时从每个分叉点 DFS，找每条路径的最深 chapter
// 按 depth 排序，取 top 3*N 作为候选集
```

**Gas 成本**：DFS 遍历节点数 = 两轮之间从 N 个分叉点派生出的所有章节数。submissionFee 天然限制了章节数量，实际中几十到一两百章。假设 200 个节点，每个 SLOAD ≈ 2100 gas，总计 ~420,000 gas，由 keeper 承担。

可设置 `maxDfsNodes` 安全上限，防止极端情况下 gas 超限。

### 4.3 三阶段投票

每轮 round 分三个阶段：

```
Nominating → Committing → Revealing → Settlement
```

**Nominating（提名阶段）：**
- Keeper 调用 `startRound()` 开启新一轮
- 合约从 worldLineAncestors 做 DFS，自动生成候选集（最深的 3*N 条链）
- **startRound 要求 DFS 候选数 >= 1，否则 revert**（至少有一个后代才能开轮）
- 用户可以支付 `nominationFee` 提名额外的链（任意链；不在世界线后代上的链也可提名但获奖受限）
- 提名费进入 prize pool
- 持续 `nominateDuration`
- settleRound 时选出 top N 世界线，不足 N 条则有多少选多少

**Committing（投票阶段）：**
- `commitVote(novelId, commitHash)` ，`commitHash = keccak256(candidateId, salt)`
- 需质押 `voteStake` 作为 Sybil resistance
- 每地址每轮只投一票
- 持续 `commitDuration`

**Revealing（揭露阶段）：**
- `revealVote(novelId, candidateId, salt)`
- 验证 hash 匹配
- 投票权重 = 质押金额
- 持续 `revealDuration`

**Settlement：**
- Keeper 调用 `settleRound()`
- 按得票权重排序，选出 top N 条世界线（不足 N 条则有多少选多少）
- 同票时，depth 更大的链胜出
- 更新 worldLineAncestors 为新胜出的 N 个 chapterId
- 分配奖励（见第 5 节）
- 返还已 reveal 的质押 + 分配未 reveal 的质押
- 回到 Idle 状态

### 4.4 第一轮投票

第一轮没有"上一轮世界线"，所以：
- 从 root chapter 做 DFS，找最深的 M 条链作为候选
- 投票产生第一批 N 条世界线（即初始 worldLineAncestors）
- 第一轮所有候选链的作者都可获奖

### 4.5 投票与写作的并行

```
Timeline:
|-- Round 1 Voting --|-- Round 2 Voting --|-- Round 3 Voting --|
|==== Writing (always on) ==========================================|
```

写作不会被投票阻断。投票是对**已有内容**的评选。投票期间新提交的章节不影响本轮候选，但会参与下一轮。

---

## 5. 奖励分配

### 5.1 资金来源

| 来源 | 说明 |
|------|------|
| 创建小说初始资金 | creator 创建时存入 |
| Chapter 提交费 | `submissionFee`，每次提交 |
| 提名费 | `nominationFee`，用户提名候选链 |
| Fork 费 | 进入源小说 prize pool |
| 打赏 | `tipNovel()` |

### 5.2 每轮分配

每轮 round 结算时，从 prize pool 释放一部分：

```
releaseAmount = poolBalance * prizeReleaseRate / 10000
```

分配（无 protocol fee，如需开启通过合约升级）：

```
releaseAmount
  ├─ creatorRoyalty = releaseAmount * CREATOR_DECAY_DIVISOR / (CREATOR_DECAY_DIVISOR + currentRound)
  ├─ remaining      = releaseAmount - creatorRoyalty
  ├─ authorRewards  = remaining * (10000 - voterRewardRate) / 10000
  └─ voterRewards   = remaining - authorRewards
```

### 5.3 Creator Royalty 衰减

按 round 平滑衰减：`royalty = releaseAmount * D / (D + currentRound)`

`D = CREATOR_DECAY_DIVISOR` 为合约级别常量（如 3），控制衰减速度。Creator 不可配置，升级可改。使用 `D / (D + round)` 而非 `1 / (1 + round/D)` 避免整数除法导致的阶梯跳变。

| Round | DIVISOR=1 | DIVISOR=2 | DIVISOR=3 | DIVISOR=4 | DIVISOR=5 |
|-------|-----------|-----------|-----------|-----------|-----------|
| 1     | 50%       | 67%       | 75%       | 80%       | 83%       |
| 2     | 33%       | 50%       | 60%       | 67%       | 71%       |
| 3     | 25%       | 40%       | 50%       | 57%       | 63%       |
| 4     | 20%       | 33%       | 43%       | 50%       | 56%       |
| 5     | 17%       | 29%       | 38%       | 44%       | 50%       |
| 6     | 14%       | 25%       | 33%       | 40%       | 45%       |
| 7     | 13%       | 22%       | 30%       | 36%       | 42%       |
| 8     | 11%       | 20%       | 27%       | 33%       | 38%       |
| 9     | 10%       | 18%       | 25%       | 31%       | 36%       |
| 10    | 9%        | 17%       | 23%       | 29%       | 33%       |

简单、可预测、无需追踪 cumulative canon chapters。DIVISOR=5 给 creator 更持续的激励。

### 5.4 Author Rewards

**只奖励本轮新增的世界线章节。**

设第 K 轮投票选出世界线 {W1, W2, ...}，上轮 worldLineAncestors 为 {A1, A2, ...}。从每个 Wi 沿 parentId 往上走到对应的 Ai，收集路径上所有新增章节（depth 大于 Ai 的 depth）。**多条世界线共享的路径章节只计一次（去重）。**

分配方式：**去重后按章节数量等分 authorRewards**。同一作者有多章则获得多份。

**提名链的奖励限制**：
- DFS 自动候选（世界线后代）：正常发放作者奖励
- 用户提名且是世界线后代：正常发放作者奖励
- 用户提名且**不是**世界线后代：**不发放作者奖励**，仅影响下一轮世界线选取

### 5.5 Voter Rewards

**已 reveal 的投票者按质押比例分奖励，投中世界线的投票者获得 3x 权重。**

奖励来源：
1. **Prize pool 释放的 voterRewards 部分**
2. **未 reveal 投票者的质押**（没收后按比例分配给已 reveal 者）

```solidity
// 精度加权
accurateWeight = myStake * 3   // 投中世界线
normalWeight   = myStake * 1   // 未投中但 reveal
totalWeight    = totalRevealedStake + totalAccurateStake * 2

// 每个 revealed voter 的奖励
myReward = (voterRewards + unrevealedStakes) * myWeight / totalWeight

// 总领取 = myStake(退还) + myReward
```

**3x 权重的安全性**：commit-reveal 隐藏投票内容，投票期间无法看到他人投票，"跟风投热门"不可行。作者投自己的链是合理行为，经济上自平衡。

### 5.6 关于 Protocol Fee

移除 Protocol Fee。合约中不设 `protocolFeeRate` / `protocolTreasury`，也不提供 setter。如果未来需要开启，通过合约升级（UUPS）实现。

理由：
- 简化分配逻辑，减少攻击面
- 避免 owner 权力过大的信任问题
- 升级路径已有（UUPS），不需要预留运行时开关

### 5.7 Keeper Rewards

延用 V1 方案：owner 设置 `keeperRewardAmount`，每次状态转换调用（`startRound`、`closeNomination`、`closeCommit`、`settleRound`）时从 prize pool 支付给 caller。通过 `PrizePool.payKeeperReward()` 实现。

### 5.8 Claim 机制

保留 pull-based claim：`claimReward(novelId)` 提取累积奖励。

---

## 6. Tip 与续写悬赏 (BountyBoard)

三种 Tip 方式，前两种在 PrizePool 中实现，第三种独立为 BountyBoard 合约。

### 6.1 Tip 小说

```solidity
function tipNovel(uint64 novelId) external payable;
```

全额进入 prize pool。与 V1 一致。

### 6.2 Tip 章节

```solidity
function tipChapter(uint64 chapterId) external payable;
```

- 50% push 转给章节 author
- 50% 进入 prize pool
- 如果 push 失败（author 是恶意合约），失败的 50% 也进入 prize pool（惩罚恶意 address）

### 6.3 续写悬赏 (Bounty)

读者对某个章节发起悬赏，激励他人续写。独立的 `BountyBoard` 合约，只依赖 NovelCore 读 chapter 数据。

#### 6.3.1 创建悬赏

```solidity
function createBounty(uint64 chapterId, uint64 deadline) external payable;
```

- 读者付 ETH，指定追更的章节和提交截止时间 `deadline`
- 20% 立即转入 prize pool
- 80% 锁在 BountyBoard 中

#### 6.3.2 作者参与

无需额外操作。作者正常调用 `NovelCore.submitChapter(parentId = targetChapterId)` 即可。BountyBoard 通过读取 `chapters[targetChapterId].descendants` 中 `timestamp <= deadline` 的章节确定 qualifying 作者。

#### 6.3.3 奖励分配

**deadline 前有续写**：80% 平分给所有 qualifying 作者，deadline 后可 claim。

**deadline 时无续写**：80% 退还给读者（tipper）。

#### 6.3.4 数据结构

```solidity
struct Bounty {
    uint64 chapterId;        // 追更哪个章节
    address tipper;
    uint256 lockedAmount;    // 锁定金额（80% of total，20% 已转 prize pool）
    uint64 deadline;         // 作者提交截止
    bool claimed;            // 是否已分配/退还
}

mapping(uint256 => Bounty) bounties;           // bountyId → Bounty
mapping(uint256 => mapping(address => bool)) hasClaimed;  // bountyId, author → claimed
```

#### 6.3.5 合约接口

```solidity
interface IBountyBoard {
    function createBounty(uint64 chapterId, uint64 deadline) external payable returns (uint256 bountyId);
    function claimBounty(uint256 bountyId) external;       // 作者领取（deadline 后）
    function refundBounty(uint256 bountyId) external;      // 读者退回（deadline 后无续写）
    function getBounty(uint256 bountyId) external view returns (Bounty memory);
    function getBountiesForChapter(uint64 chapterId) external view returns (uint256[] memory);
}
```

---

## 7. 合约架构

### 7.1 合约拓扑

```
NovelCore (核心协调器)
  ├── VotingEngine (三阶段投票)
  ├── PrizePool (资金管理与分配，含 tipNovel / tipChapter)
  ├── RulesEngine (世界观规则治理)
  └── BountyBoard (续写悬赏，独立模块)
```

移除：ChapterNFT、ReportRegistry

### 7.2 NovelCore 职责

- 小说创建 / Fork
- Chapter 提交与双向树管理
- Round 生命周期管理（startRound DFS → phase transitions → settleRound）
- worldLineAncestors 维护
- Keeper 奖励

### 7.3 VotingEngine 职责

- Commit-Reveal 投票
- 计票与排名
- 投票质押管理与分配

### 7.4 PrizePool 职责

- 资金存入（submission fee, nomination fee, fork fee, tips）
- tipNovel / tipChapter 实现
- 每轮奖励分配计算
- Creator / Author / Voter 奖励记账
- Pull-based claim

### 7.5 BountyBoard 职责

- 续写悬赏的创建、选择、领取
- 只读依赖 NovelCore（读 chapter 数据验证 parent-child 关系）
- 写依赖 PrizePool（20% 转入 prize pool）

### 7.6 RulesEngine 职责

保持不变：
- Creator 初始规则设定
- 规则提案（任何人支付 `ruleFee`）
- 投票权改为：**当前世界线上有章节的作者**

---

## 8. 数据结构详细设计

```solidity
// ========= DataTypes.sol =========

enum ContentLocation { Onchain, External, HTTP }

enum RoundPhase {
    Idle,          // 未在投票（两轮之间，settleRound 后回到 Idle）
    Nominating,    // 提名阶段
    Committing,    // 投票 commit
    Revealing      // 投票 reveal
}

struct NovelConfig {
    // 章节参数
    uint64 minChapterLength;
    uint64 maxChapterLength;
    uint256 submissionFee;       // 提交章节费用（进 prize pool）

    // 投票参数
    uint32 worldLineCount;       // N: 每轮产生的世界线数量
    uint256 voteStake;           // 投票质押金额
    uint256 nominationFee;       // 用户提名费
    uint64 nominateDuration;     // 提名阶段持续时间
    uint64 commitDuration;       // 投票 commit 阶段
    uint64 revealDuration;       // 投票 reveal 阶段
    uint64 minRoundGap;          // 两轮之间最小间隔

    // 经济参数
    uint16 prizeReleaseRate;     // 每轮释放比例 (basis points, max 5000)
    uint16 voterRewardRate;      // 投票者奖励比例 (basis points, max 5000)

    // 内容存储
    ContentLocation contentLocation;
    string contentBaseUrl;

    // 规则治理
    uint256 ruleFee;
    uint64 ruleVoteDuration;
    uint32 ruleQuorum;
}

struct Novel {
    uint64 id;
    address creator;
    NovelConfig config;
    uint32 currentRound;         // 当前 round（0 = 尚未开始投票）
    RoundPhase roundPhase;
    uint64 phaseStartTime;
    uint64 lastSettleTime;       // 上轮结算时间（用于 minRoundGap 检查）
    bool active;
    // 无 fork 字段 —— 从 root chapter 的 parentId 推导
}

struct Chapter {
    uint64 id;
    uint64 novelId;
    uint64 parentId;            // 0 = 原创 root; 跨小说 ID = fork root; 本小说 ID = 续写
    address author;
    bytes32 contentHash;
    uint64 declaredLength;
    uint32 depth;               // 本小说内树深度，root = 1
    uint64 timestamp;
    uint64[] descendants;       // 子章节 ID 列表
}

struct RoundData {
    uint64[] candidates;        // 候选链 chapter IDs（DFS 自动生成 + 用户提名）
    bool[] candidateIsEligible; // 是否世界线后代（影响作者奖励）
    uint64[] prevWorldLines;    // 上轮 worldLineAncestors（用于计算新增章节）
    uint64 nominateEndTime;
    uint64 commitEndTime;
    uint64 revealEndTime;
    bool settled;
}

struct VoteCommit {
    bytes32 commitHash;
    uint256 stakeAmount;
    bool revealed;
    uint64 revealedCandidateId;
}
```

### 8.1 核心 Mapping

```solidity
// ===== NovelCore =====
mapping(uint64 => Novel) novels;
mapping(uint64 => Chapter) chapters;
mapping(uint64 => uint64) novelRootId;              // novelId → root chapter ID
mapping(uint64 => uint64[]) worldLineAncestors;     // novelId → 当前世界线分叉点 chapter IDs
mapping(uint64 => mapping(uint32 => RoundData)) rounds;

// ===== VotingEngine =====
mapping(bytes32 => VoteCommit) voteCommits;          // keccak(novelId, round, voter)
mapping(bytes32 => uint256) voteCounts;              // keccak(novelId, round, candidateId) → weight
mapping(bytes32 => address[]) roundVoters;           // keccak(novelId, round) → voters

// ===== PrizePool =====
mapping(uint64 => uint256) poolBalances;
mapping(uint64 => mapping(address => uint256)) pendingRewards;
```

---

## 9. 状态流转

```
Novel Created (creator 提交 root chapter)
       │
       ▼
    [Idle]  ◄─────────────────────────────────────────┐
       │                                               │
       │  keeper: startRound()                         │
       │  (需距上轮 settle ≥ minRoundGap)              │
       │  (DFS 候选 >= 1，否则 revert)                 │
       ▼                                               │
  [Nominating] ── nominateDuration ──┐                 │
       │                             │                 │
       │  closeNomination()          │                 │
       ▼                             │                 │
  [Committing] ── commitDuration ──┐ │  Writing        │
       │                           │ │  continues      │
       │  closeCommit()            │ │  in parallel    │
       ▼                           │ │                 │
  [Revealing]  ── revealDuration ─┐│ │                 │
       │                          ││ │                 │
       │  settleRound()           ││ │                 │
       │  (→ 直接回到 Idle)       ││ │                 │
       └──────────────────────────┘┘─┘─────────────────┘
```

---

## 10. 安全性考量

### 10.1 Keeper 信任度

Keeper 无法影响候选选取：
- **候选来自 DFS** —— 从 worldLineAncestors 出发，遍历 `descendants` 找最深路径，算法确定性，链上可审计
- **Nomination 阶段兜底** —— 任何人可付费补充 DFS 未覆盖的链
- Keeper 唯一能做的"坏事"是不调用 `startRound()`（拖延投票），但无法影响候选选取

### 10.2 DFS Gas 安全

`startRound` 的 DFS 遍历节点数取决于两轮之间 worldLineAncestors 后代的章节数。

**缓解**：
- `submissionFee` 限制章节总数
- 设置 `maxDfsNodes`（如 500）安全上限，超出截断（取已发现的最深 M 条）
- Gas 由 keeper 承担，不影响用户提交

### 10.3 投票博弈

- **自投票**：作者给自己的链投票，成本 = `voteStake`。经济上自平衡。
- **Sybil 投票**：权重按质押线性计算，拆分无收益。
- **不 reveal**：质押没收并分配给 revealed 投票者。
- **精度激励**：投中世界线 3x 权重，未投中 1x。commit-reveal 隐藏投票，防止跟风。

### 10.4 Chapter Spam

提交费 `submissionFee` 是防 spam 的第一道防线。费用进入 prize pool，spam 者实际上在补贴好的创作者。

### 10.5 长链攻击

攻击者快速提交大量短章节使某条链变"最深"，试图挤掉好链的候选位。

**缓解**：
1. 每次提交付 `submissionFee`，批量 spam 成本高，且扩充了 prize pool
2. `minChapterLength` 限制最短章节长度；Onchain 模式可验证实际内容大小
3. 即使进入候选，投票者决定最终世界线，spam 链不会被投中
4. **Nominating 阶段**可以抢救被挤掉的好链
5. `maxDfsNodes` 限制 DFS 范围，超大树不会拖垮 gas
6. **M = 3*N** 候选位充足，spam 难以挤掉所有好链

### 10.6 提名 Spam

高 `nominationFee` 阻止无意义提名。提名费进入 prize pool。

---

## 11. 经济模型分析

### 11.1 资金循环

```
                  ┌─────────────────────────────────────┐
                  │           Prize Pool                 │
                  │                                      │
  submissionFee ──┤                                      ├──→ Creator Royalty
  nominationFee ──┤                                      ├──→ Author Rewards
  forkFee ────────┤                                      ├──→ Voter Rewards
  tips ───────────┤                                      ├──→ Keeper Rewards
  genesis fund ───┤                                      │
                  └─────────────────────────────────────┘
```

### 11.2 激励对齐

| 角色 | 激励 | 行为 |
|------|------|------|
| Creator | 衰减的 royalty + 作为 author 的奖励 | 创建吸引人的小说开头 |
| Author | 世界线上的章节奖励 | 在热门世界线上续写高质量内容 |
| Voter | 质押返还 + voterRewards（投中世界线 3x 权重）+ 未 reveal 者质押分成 | 投票给真正好的链，按时 reveal |
| Keeper | Keeper reward | 及时推进投票流程 |
| Reader | 打赏影响 prize pool | 支持好的小说 |
| Nominator | 补充被遗漏的好链 | 发现 DFS 未覆盖的优质内容 |

### 11.3 与 V1 的经济差异

1. **持续的资金流入**：V1 提交费锁定为 stake 最终退还；V2 提交费直接进入 prize pool
2. **更频繁的分配**：V1 每 epoch（K 轮）分配一次；V2 每轮分配
3. **更简单的 Creator 衰减**：按 round 编号衰减
4. **投票奖励**：投中世界线 3x 权重，简单直接
5. **无 slash 机制**：fee-based 替代 stake-slash

---

## 12. 配置参数参考值

| 参数 | 建议默认值 | 说明 |
|------|-----------|------|
| `minChapterLength` | 100 bytes | 最短章节 |
| `maxChapterLength` | 50,000 bytes | 最长章节 |
| `submissionFee` | 0.001 ETH | 提交费 |
| `worldLineCount` (N) | 3 | 每轮世界线数量 |
| `voteStake` | 0.005 ETH | 投票质押 |
| `nominationFee` | 0.01 ETH | 提名费（高于提交费） |
| `nominateDuration` | 1 day | 提名阶段 |
| `commitDuration` | 2 days | 投票阶段 |
| `revealDuration` | 1 day | 揭露阶段 |
| `minRoundGap` | 1 day | 两轮最小间隔 |
| `prizeReleaseRate` | 2000 (20%) | 每轮释放比例 |
| `voterRewardRate` | 1500 (15%) | 投票者奖励比例 |

---

## 13. 额外建议

### 13.1 关于投票质押返还

**建议：settlement 时统一返还。** reveal 时不返还，理由：
- 需要等 reveal 阶段结束才知道 unrevealed stakes 总额
- Settlement 统一处理逻辑更清晰
- 从 reveal 到 settlement 的等待时间有限

### 13.2 关于世界线中间节点的分叉

如果 round K 的世界线分叉点是 chapter 50，有人从 chapter 30（世界线路径中间节点）分叉出去：

**不算世界线后代。** DFS 从 worldLineAncestors（chapter 50）出发，只遍历 50 的 descendants。从 chapter 30 分叉的链不在 DFS 范围内，不会自动成为候选。

如果创作者认为从中间节点分叉的故事有价值，可以通过 **Nominating 阶段付费提名**参与投票。这保持了 DFS 的简洁性，同时 Nominating 作为安全网覆盖边缘情况。

### 13.3 关于 Rules 中 "canon author" 的重定义

没有 canon 概念了。规则投票权改为：**当前世界线上有章节的作者**。每轮投票结果更新后，资格随之更新。

### 13.4 关于小说完结

保留 `completeNovel()` 功能：
- **谁可以发起**：creator 可随时发起；任何人在小说无活动超过 `INACTIVITY_TIMEOUT`（合约级别常量，如 30 天）后可发起
- **prize pool 最终分配**：一次性释放剩余 pool，按最后一轮世界线从 root 到世界线分叉点的完整路径上所有章节（去重）的作者按章节数等分。若从未完成过投票，则世界线路径即 root 到最深章节，creator 作为唯一作者获得全部
- **Bounty 清理**：该小说所有未领取的 bounty 锁定金额转入 prize pool（在最终分配之前）
- **Event**：emit 完结事件，后端 indexer 据此更新状态
- 不再接受新章节和新投票轮

---

## 14. 合约接口概览

```solidity
interface INovelCore {
    // 创建
    function createNovel(
        NovelConfig calldata config,
        NovelMetadata calldata metadata,
        ContentSubmission calldata rootChapter
    ) external payable returns (uint64 novelId);

    function forkNovel(
        uint64 sourceChapterId,                    // 源小说的章节 ID
        NovelConfig calldata config,
        NovelMetadata calldata metadata,
        ContentSubmission calldata rootChapter     // fork root 的全新内容
    ) external payable returns (uint64 novelId);

    // 章节（随时可调用）
    function submitChapter(
        uint64 novelId,
        uint64 parentId,
        bytes32 contentHash,
        uint64 declaredLength,
        bytes calldata content
    ) external payable;

    // 投票生命周期（keeper 驱动）
    function startRound(uint64 novelId) external;        // DFS 生成候选集
    function closeNomination(uint64 novelId) external;
    function closeCommit(uint64 novelId) external;
    function settleRound(uint64 novelId) external;

    // 提名（Nominating 阶段）
    function nominateCandidate(
        uint64 novelId,
        uint64 chapterId
    ) external payable;

    // 投票（Committing / Revealing 阶段）
    function commitVote(uint64 novelId, bytes32 commitHash) external payable;
    function revealVote(uint64 novelId, uint64 candidateId, bytes32 salt) external;

    // 领取
    function claimReward(uint64 novelId) external;

    // Tip
    function tipNovel(uint64 novelId) external payable;
    function tipChapter(uint64 chapterId) external payable;

    // 管理
    function completeNovel(uint64 novelId) external;

    // 查询
    function getNovel(uint64 novelId) external view returns (Novel memory);
    function getChapter(uint64 chapterId) external view returns (Chapter memory);
    function getWorldLineAncestors(uint64 novelId) external view returns (uint64[] memory);
    function getRoundData(uint64 novelId, uint32 round) external view returns (RoundData memory);
}

// BountyBoard 接口见第 6.3.5 节
```

---

## 15. 迁移与兼容性

V1 和 V2 目前都处于 dev 阶段，无已上线的合约和数据，不需要考虑任何兼容性和数据迁移问题。实现时直接在现有代码库上重写即可。

---

## 16. Agent 工具集成（CLI + MCP + Skills）

### 16.1 分发方式

单一 npm 包 `onchain-novel`，提供 CLI、MCP server、Skills 三种使用方式：

```bash
npm install -g onchain-novel
```

### 16.2 `onchain-novel setup`

在用户当前目录自动生成配置和 skill 文件：

```
.mcp.json                        # MCP server 配置
.claude/commands/
  ├── novel-author.md             # /novel-author → 续写工作流
  ├── novel-voter.md              # /novel-voter → 投票工作流
  ├── novel-creator.md            # /novel-creator → 创建/管理工作流
  └── novel-reader.md             # /novel-reader → 浏览/打赏/悬赏工作流
```

`.mcp.json` 示例：
```json
{
  "mcpServers": {
    "onchain-novel": {
      "command": "onchain-novel",
      "args": ["mcp"],
      "env": { "RPC_URL": "...", "PRIVATE_KEY": "..." }
    }
  }
}
```

setup 时交互式询问 RPC_URL、PRIVATE_KEY 等配置。

### 16.3 CLI 子命令

```bash
# 初始化
onchain-novel setup                              # 生成 .mcp.json + skills
onchain-novel config                             # 查看/修改配置
onchain-novel mcp                                # 启动 MCP server

# 小说
onchain-novel novel create [options]
onchain-novel novel info <id>
onchain-novel novel list
onchain-novel novel fork <chapter-id> [options]
onchain-novel novel complete <id>

# 章节
onchain-novel chapter submit <novel-id> <parent-id> --content "..."
onchain-novel chapter read <chapter-id>
onchain-novel chapter tree <novel-id>
onchain-novel chapter descendants <chapter-id>

# 投票
onchain-novel vote start <novel-id>              # keeper: startRound
onchain-novel vote nominate <novel-id> <chapter-id>
onchain-novel vote commit <novel-id> <candidate-id> <salt>
onchain-novel vote reveal <novel-id> <candidate-id> <salt>
onchain-novel vote settle <novel-id>             # keeper: settleRound
onchain-novel vote claim <novel-id> <round>
onchain-novel vote candidates <novel-id>

# 打赏 & 悬赏
onchain-novel tip novel <novel-id> --value 0.01
onchain-novel tip chapter <chapter-id> --value 0.01
onchain-novel bounty create <chapter-id> --value 0.1 --deadline 7d
onchain-novel bounty claim <bounty-id>
onchain-novel bounty refund <bounty-id>

# 规则
onchain-novel rule list <novel-id>
onchain-novel rule set <novel-id> <name> <content>
onchain-novel rule propose <novel-id> add|delete <name> [content]
onchain-novel rule vote <proposal-id>

# 工作流指南
onchain-novel guide author|voter|creator|reader
```

### 16.4 数据来源

| 操作 | 来源 |
|------|------|
| 读操作（list, info, tree, candidates） | backend REST API |
| 写操作（create, submit, commit, reveal） | 直接链上交易（viem） |
| guide | npm 包内嵌 markdown |

CLI 配置项（`onchain-novel config` 管理）：
- `rpcUrl` — 链 RPC
- `privateKey` — 签名用
- `apiUrl` — backend API 地址
- `contracts` — 合约地址（可从 backend API 自动获取）

### 16.5 目录结构

```
cli/                             # CLI + MCP + Skills 统一包
  bin/onchain-novel              # CLI 入口
  commands/                      # 子命令实现
  guides/                        # 内嵌工作流文档
  skills/                        # setup 时复制到 .claude/commands/ 的模板
  mcp/                           # MCP server 实现
shared/                          # CLI 和 MCP 共享的链交互逻辑
  abi/                           # 合约 ABI
  contracts.ts                   # 链交互封装（createNovel, submitChapter 等）
  config.ts                      # 地址、RPC 配置
```

---

## 17. Web Backend 架构（Indexer + REST API）

**事件索引器 + 只读查询 API + 可选 Keeper 服务**。

### 17.1 目录结构

```
web/backend/src/
  index.ts                # Express server + indexer + keeper + 后台任务启动
  db/                     # PostgreSQL 连接 + 迁移（单个 001_init.sql，从零开始）
  indexer/
    index.ts              # 事件轮询循环（自适应 batch、RPC 轮换、重试）
    handlers.ts           # 事件处理器（解析事件 → 写 DB）
    content-fetcher.ts    # External/HTTP 模式内容拉取 + 重试
  keeper/
    index.ts              # 自动 keeper：扫描活跃小说，触发 phase 转换，领取奖励
  api/
    novels.ts             # 小说列表/详情/tree/worldlines/rounds/forks/stats/tips
    chapters.ts           # 章节详情/children/context/siblings/comments/bounties/tips
    users.ts              # 用户投票/奖励/章节历史
    bounties.ts           # 悬赏查询
    rules.ts              # 规则/提案查询
    content.ts            # 内容 hash 计算（External/HTTP 辅助）
  utils/
    abi.ts                # 合约 ABI（事件签名精确匹配合约 indexed 关键字）
    env.ts                # 环境变量
    validate.ts           # 请求参数校验
    auth.ts               # EIP-191 签名验证（评论鉴权）
    pool-sync.ts          # 定时从链上同步 prize pool 余额
```

**已移除的功能**：
- 通知系统（notifications）— 复杂度高，非核心
- Novel ranking 独立端点 — 合并到 list 的 sort 参数

### 17.4 Keeper 服务

可选的自动 keeper，配置 `KEEPER_PRIVATE_KEY` 后启动。从 DB 读取小说状态（indexer 已维护），自动触发 phase 转换。

```env
KEEPER_PRIVATE_KEY=0x...           # 可选，不配置则不启动
KEEPER_POLL_INTERVAL_MS=10000      # 默认 10 秒
```

逻辑：
```
每 N 秒扫描活跃小说:
  Idle     && lastSettleTime + minRoundGap <= now     → startRound(novelId)
  Nominating && phaseStartTime + nominateDuration <= now → closeNomination(novelId)
  Committing && phaseStartTime + commitDuration <= now   → closeCommit(novelId)
  Revealing  && phaseStartTime + revealDuration <= now   → settleRound(novelId)
```

- 从 DB 读状态（不额外读链），发交易失败（已被其他 keeper 执行）静默跳过
- Keeper 奖励自动到配置地址，可随时通过 CLI 调用 `claimReward`
- 不配置 `KEEPER_PRIVATE_KEY` 则 backend 退化为纯 indexer + API

### 17.2 Indexer

- 轮询链上事件，监听 5 个合约地址（NovelCore、VotingEngine、PrizePool、BountyBoard、RulesEngine）
- 自适应 batch size + RPC 轮换 + 指数退避重试
- 每批事件在单个 DB 事务中处理，单条事件失败不影响整批
- 确认块数（`INDEXER_CONFIRMATION_BLOCKS`）防重组

### 17.3 REST API

| 端点 | 说明 |
|------|------|
| `GET /api/novels` | 列表（分页、排序、搜索、过滤） |
| `GET /api/novels/:id` | 详情（含 config、phase、round 信息） |
| `GET /api/novels/:id/tree` | 章节树 |
| `GET /api/novels/:id/worldlines` | 当前世界线 |
| `GET /api/novels/:id/rounds/:round` | 投票轮次数据 |
| `GET /api/novels/:id/forks` | Fork 列表 |
| `GET /api/novels/:id/stats` | 统计 |
| `GET /api/novels/:id/tips` | 打赏记录 |
| `GET /api/novels/:id/bounties` | 悬赏列表 |
| `GET /api/novels/:id/rules` | 规则列表 |
| `GET /api/novels/:id/rule-proposals` | 规则提案 |
| `GET /api/chapters/:id` | 章节详情 |
| `GET /api/chapters/:id/children` | 子章节 |
| `GET /api/chapters/:id/context` | 祖先链 |
| `GET /api/chapters/:id/siblings` | 兄弟章节 |
| `GET /api/chapters/:id/comments` | 评论 |
| `GET /api/chapters/:id/bounties` | 章节悬赏 |
| `GET /api/chapters/:id/tips` | 章节打赏 |
| `GET /api/bounties/:id` | 悬赏详情 |
| `GET /api/users/:address/votes` | 用户投票历史 |
| `GET /api/users/:address/rewards` | 用户奖励 |
| `GET /api/users/:address/chapters` | 用户章节 |
| `POST /api/content/upload` | 内容 hash 计算 |

---

## 18. 实现优先级

1. **Phase 1 - 合约核心**：DataTypes + NovelCore + PrizePool ✅
2. **Phase 2 - 投票引擎**：VotingEngine ✅
3. **Phase 3 - 规则引擎**：RulesEngine ✅
4. **Phase 4 - 续写悬赏**：BountyBoard ✅
5. **Phase 5 - 后端**：Indexer + REST API ✅
6. **Phase 6 - Shared Lib**：ABI、合约交互封装（CLI 和 MCP 共用）
7. **Phase 7 - CLI**：`onchain-novel` 命令行工具（setup + 子命令 + guide）
8. **Phase 8 - MCP**：MCP server 重构（基于 shared lib）
9. **Phase 9 - Skills**：`.claude/commands/*.md` 工作流文件编写
10. **Phase 10 - 前端**：Web UI 重构
