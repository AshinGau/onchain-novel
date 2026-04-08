# 合约设计

## 1. 章节树 (Chapter Tree)

### 1.1 数据结构

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

### 1.2 提交规则

- **随时可提交**，不受投票阶段影响
- 任意已有 chapter 都可作为 parent（包括不在世界线上的）
- 提交时支付 `submissionFee`（不可退还），直接进入 prize pool
- 同一作者可提交多章，不限频率（fee 本身就是防 spam）
- Root chapter（depth = 1）只能由 creator 在 `createNovel` / `forkNovel` 时提交，有且仅有一章
- 提交时自动 `chapters[parentId].descendants.push(chapter.id)`，O(1)

### 1.3 链 (Chain) 的定义

一条 **chain** 是从 root 到某个 chapter 的完整路径。chain 由其末端 chapter ID 唯一标识。

```
root(1) → ch(2) → ch(4) → ch(7)    ← chain 7
              └→ ch(5) → ch(8)      ← chain 8
         └→ ch(3) → ch(6)           ← chain 6
```

**投票是对某个 chapterId 投票**，不存在"leaf chapter"的概念——因为投票期间写作仍在继续，任何 chapter 随时可能有新的后继。

### 1.4 Fork — 通过 Root Chapter 的 parentId 统一标识

**核心设计：Fork 小说的 root chapter 的 `parentId` 指向源小说的分叉章节（跨小说引用）。**

判断小说类型：
- **原创小说**：root chapter 的 `parentId = 0`，`depth = 1`
- **Fork 小说**：root chapter 的 `parentId != 0 && depth == 1`

仅用 chapter 自身字段即可判断，无需额外 SLOAD。

Fork 的其他规则：
- Fork 发起人成为新小说的 **creator**
- Fork root 是 forker 提交的**全新内容**（不复制源章节内容），`parentId` 指向源章节仅作为来源标识
- 支付 fork fee = `max(submissionFee, sourcePoolBalance * forkFeeRate / 10000)`，进入**源小说**的 prize pool。`forkFeeRate` 为合约级别常量，成功小说的 fork 成本与其价值成正比
- 新小说的 config 可自由设定（`contentLocation` 继承源小说）

---

## 2. 投票机制

### 2.1 候选集的必要性

用户不能对任意 chapterId 投票，必须有固定的候选集。原因：**投票分裂问题**。

例如两条故事线 `C1←C2←C3` 和 `C1←A1←A2`，三票分别投 C2(权重1)、C3(权重1)、A2(权重1.1)。如果允许对任意 chapter 投票，A2 以 1.1 胜出。但 C2 和 C3 在同一条链上，合并后权重为 2，理应胜出。

**候选集确保每条链只有一个代表（该链最深的 chapter），投票不会分裂。**

### 2.2 候选集的产生 — 从世界线分叉点 DFS

利用 chapter 的 `descendants` 双向索引，`startRound` 时从每个世界线分叉点（worldLineAncestors）做 DFS，找到最深的 M = 3*N 条链（N 为 `worldLineCount`，creator 设置）。

**Gas 成本**：DFS 遍历节点数 = 两轮之间从 N 个分叉点派生出的所有章节数。submissionFee 天然限制了章节数量。可设置 `maxDfsNodes` 安全上限。

### 2.3 三阶段投票

```
Nominating → Committing → Revealing → Settlement
```

**Nominating**：Keeper 调用 `startRound()` 开启新一轮。合约从 worldLineAncestors 做 DFS 自动生成候选集。startRound 要求 DFS 候选数 >= 1。用户可以支付 `nominationFee` 提名额外的链。持续 `nominateDuration`。

**Committing**：`commitVote(novelId, commitHash)`，需质押 `voteStake`。每地址每轮只投一票。持续 `commitDuration`。

**Revealing**：`revealVote(novelId, candidateId, salt)`，投票权重 = 质押金额。持续 `revealDuration`。

**Settlement**：Keeper 调用 `settleRound()`。按得票权重排序选出 top N 条世界线（不足 N 则有多少选多少）。同票时 depth 更大的链胜出。更新 worldLineAncestors。分配奖励。返还质押。回到 Idle。

### 2.4 状态流转

```
[Idle] → startRound(DFS) → [Nominating] → closeNomination → [Committing]
→ closeCommit → [Revealing] → settleRound → [Idle]
```

写作与投票完全并行，互不阻塞。

---

## 3. 奖励分配

### 3.1 资金来源

submissionFee、nominationFee、forkFee、tips、genesis fund → Prize Pool

### 3.2 每轮分配

```
releaseAmount = poolBalance * prizeReleaseRate / 10000
creatorRoyalty = releaseAmount * D / (D + currentRound)    // D = CREATOR_DECAY_DIVISOR (3)
remaining = releaseAmount - creatorRoyalty
authorRewards = remaining * (10000 - voterRewardRate) / 10000
voterRewards = remaining - authorRewards
```

### 3.3 Creator Royalty 衰减

`D/(D+round)` 平滑衰减。D=3 时：Round 1=75%, Round 3=50%, Round 10=23%。

### 3.4 Author Rewards

只奖励本轮新增的世界线章节。从每个 Wi 沿 parentId 往上走到 Ai，收集新增章节，**去重后等分**。提名的非世界线后代链胜出不发作者奖励。

### 3.5 Voter Rewards

投中世界线 3x 权重，未投中 1x。未 reveal 的质押没收分配给 revealed 投票者。

### 3.6 Keeper Rewards

每次状态转换从 prize pool 支付 `keeperRewardAmount`。

---

## 4. Tip 与续写悬赏 (BountyBoard)

### 4.1 Tip 小说

全额进入 prize pool。

### 4.2 Tip 章节

50% push 转给 author，50% 进 prize pool。push 失败则全额进 pool。

### 4.3 续写悬赏

- 创建：20% 立即进 prize pool，80% 锁定
- 有续写：80% 平分给 deadline 前提交的作者
- 无续写：80% 退还给读者

---

## 5. 合约架构

```
NovelCore (核心协调器)
  ├── VotingEngine (三阶段投票)
  ├── PrizePool (资金管理与分配，含 tip)
  ├── RulesEngine (世界观规则治理)
  └── BountyBoard (续写悬赏)
```

---

## 6. 安全性考量

- **Keeper 去信任**：候选来自 DFS，算法确定性。Nomination 兜底。
- **DFS Gas 安全**：`maxDfsNodes` 上限。
- **投票博弈**：线性权重无 sybil 优势，commit-reveal 防跟风，3x 精度激励。
- **Chapter Spam**：submissionFee + minChapterLength + M=3*N 候选位 + Nomination 抢救。
- **Protocol Fee**：移除，升级可加。

---

## 7. 配置参数参考值

| 参数 | 建议默认值 | 说明 |
|------|-----------|------|
| `minChapterLength` | 100 bytes | 最短章节 |
| `maxChapterLength` | 50,000 bytes | 最长章节 |
| `submissionFee` | 0.001 ETH | 提交费 |
| `worldLineCount` (N) | 3 | 每轮世界线数量 |
| `voteStake` | 0.005 ETH | 投票质押 |
| `nominationFee` | 0.01 ETH | 提名费 |
| `nominateDuration` | 1 day | 提名阶段 |
| `commitDuration` | 2 days | 投票阶段 |
| `revealDuration` | 1 day | 揭露阶段 |
| `minRoundGap` | 1 day | 两轮最小间隔 |
| `prizeReleaseRate` | 2000 (20%) | 每轮释放比例 |
| `voterRewardRate` | 1500 (15%) | 投票者奖励比例 |
