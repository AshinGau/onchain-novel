# 二次审查报告（按实际严重程度重排）

对 `audit-report-v2.md` 的每条 finding 逐一核实代码后重新分级。**多数 Critical/High 经核查实为防御性建议或已被现有不变量保护，但有少数被原报告漏掉的真问题。**

---

## A 类：真 Bug / 必修（4 条）

### A-1 [High] DFS 内 `_isInArrayMem` 对 storage 数组反复扫描（gas 致命）

**位置:** `RoundManager.sol:472`（_collectEligibleNewAuthors）+ `_isInArrayMem` 自身

```solidity
if (_isInArrayMem(current, rd.prevWorldLines)) break;  // arr 是 storage
```

`_isInArrayMem` 名字带 `Mem` 但参数是 `uint64[] storage`，每次调用对 `rd.prevWorldLines` 全量 SLOAD 扫描。settleRound 路径：winners (≤16) × walk steps (≤500) × prevWorldLines (≤16) ≈ 128K SLOAD。

每个 cold SLOAD ~2100 gas → 最坏 ~270M gas，**直接超过单笔 30M 区块上限**，`settleRound` 大概率 OOG。

**修复（必做）：**
```solidity
function _collectEligibleNewAuthors(...) internal view returns (address[] memory) {
    // Cache prevWorldLines to memory once
    uint64[] memory prevAncestors = rd.prevWorldLines;
    // ... use _isInArray64(current, prevAncestors, prevAncestors.length) instead
}
```

预计 settleRound gas 降一个数量级。**这是真正的 High，不修必然出事**。

---

### A-2 [Medium] path-walk helpers 静默截断

**位置:** `NovelCore._walkAndSetAuthorFlag` (MAX=1000), `RoundManager._collectPathAuthors` (MAX=1000), `_isDescendantOfWorldLine` (MAX=1000), `_collectEligibleNewAuthors` (MAX=500)

所有 walker 写法都是 `for (step < MAX && current != 0)`，到达上限时静默 `break`，不 revert。

后果：
- 某 novel 章节深度 > MAX → settleRound 时 isWorldLineAuthor 标志只清/设了下游 1000 章，上游漏处理。RulesEngine 投票资格判定错乱。
- `_collectEligibleNewAuthors` 漏掉的章节作者拿不到本轮奖励。

实际触发概率：默认 1000 步对应 1000 章节的世界线，目前 e2e 测试根本到不了。但**协议生命周期可能数年，深度突破 1000 不是天方夜谭**。

**修复建议：** 截断时 revert（强迫 owner 提升上限或拆分 novel），而非静默。或者把上限设为 `type(uint32).max` 实质放开（gas 自然也兜底）。

---

### A-3 [Medium] tipChapter 推送失败时全额转池 — 损害作者利益

**位置:** `PrizePool.sol:148-165`

```solidity
(bool success,) = author.call{value: authorShare}("");
if (!success) {
    _poolBalances[novelId] += msg.value;  // 100% 进池
}
```

若作者地址是合约且 receive revert（无意 / 配置错），打赏者本意「50% 给作者」变成 100% 进池。

更严重场景：fork novel 流程中，作者是早先 novel 的章节贡献者，可能已是 multisig / safe 类合约 → 静默无法接收 ETH。

**修复建议：** push 失败 fall back 到 pull 模式：
```solidity
if (!success) {
    _pendingRewards[novelId][author] += authorShare;  // 进 pending，非进 pool
    _poolBalances[novelId] += msg.value - authorShare;
}
```

---

### A-4 [Medium] PrizePool.distributeRoundRewards 缺 `nonReentrant`

**位置:** `PrizePool.sol:222`

函数包含 `msg.sender.call{value: voterRewards}("")`，转账给 RoundManager。当前调用方 RoundManager.settleRound 已是 `nonReentrant`，所以暂时安全。

但：
- 这是 PrizePool 自身的状态写函数（`_poolBalances -= releaseAmount`、`_pendingRewards += creatorRoyalty / authorRewards`）
- CEI 顺序虽然正确，但 belt-and-suspenders 兜底成本极小（一次 SSTORE）
- 任何未来的 caller（不只是 RoundManager）都受益

**修复（建议）：** 加 `nonReentrant`。

---

## B 类：可改可不改 / 防御性建议（5 条）

### B-1 [Low] applyWorldLineSettlement 输入未校验 novelId 归属

**位置:** `NovelCore.sol:305`

`newAncestors` 来自 RoundManager 传入。NovelCore 信任它们都属于 `novelId`，未校验 `_chapters[id].novelId == novelId`。

**实际安全性：** RoundManager.settleRound 把 `winners` 当 newAncestors 传入。winners 来自 `votingEngine.tallyVotes`，其候选集是 RoundManager 在 startRound/nominateCandidate 时已校验过 novelId 的 chapter ID。所以传入的 newAncestors **天然属于该 novel**。

**风险:** 如果未来 RoundManager 被恶意升级/写错，可向 NovelCore 注入跨 novel 的 ancestor。owner 模型下信任假设可接受，加校验是防御性增强。

**建议:** 加一个 `for (i) require(_chapters[newAncestors[i]].novelId == novelId);`，单行成本低。

---

### B-2 [Low] setRoundManager / setVotingEngine 等 admin setter 不 emit 事件

各个合约的 `setX(addr)` 函数（NovelCore.setRoundManager / setVotingEngine 等，PrizePool 类似）部分有 event 部分无。审计/索引器追踪管理操作不便。

**建议:** 统一加 `event ContractUpdated(string what, address indexed oldAddr, address indexed newAddr)`，每个 setter 必 emit。

---

### B-3 [Low] PrizePool.deposit 多源校验复用 `OnlyNovelCore` 错误

**位置:** `PrizePool.sol`（deposit 函数）

```solidity
if (msg.sender != novelCore && msg.sender != roundManager && msg.sender != rulesEngine && msg.sender != bountyBoard) revert OnlyNovelCore();
```

revert 错误名暗示「只能 NovelCore」，但实际接受 4 种来源。前端解错误码会困惑。

**建议:** 改为 `OnlyAuthorizedDepositor()` 或 `UnauthorizedDeposit()`。

---

### B-4 [Low] NovelCore initialize 不接 roundManager → 部署两步

`initialize` 后必须 owner 单独调用 `setRoundManager`。这是合理的（RoundManager 部署需要 NovelCore 地址，循环依赖通过两步打破），但若运维忘第二步，所有 round 操作 revert。

Deploy.s.sol 已正确串行调用，e2e 通过验证了。**风险主要在生产部署忘步骤**。

**建议:** 留作 ops runbook 注意事项即可。或加一个只读 `bool initializationComplete = (roundManager != address(0));` view，让监控可主动告警。

---

### B-5 [Info] startRound / closeNomination / closeCommit / nominateCandidate 缺 `nonReentrant`

经核查：
- 这四个函数的外部 call 都在 state 写**之后**（CEI 顺序对）
- 重入回 startRound 会因 `phase != Idle` revert
- 重入回 closeNomination 会因 `phase != Nominating` revert
- nominateCandidate 重入会重复加 candidate（rd.candidates 已写），但 PrizePool.deposit 内无外部 call，无法重入

**结论:** 当前安全，加 `nonReentrant` 是 belt-and-suspenders。可加可不加。

---

## C 类：原报告误判 / 已被现有不变量覆盖（7 条）

### C-1 ❌ 原 1.1 「applyWorldLineSettlement 双 author 路径竞态 Critical」 — **不是 Bug**

原报告说先清后设、未来可能引入 reentry 等。

**核实:** 函数完全同步、纯状态写、无外部 call。当前没有任何重入向量。「未来可能扩展引入 reentry」是 hypothetical，且当真需要扩展时再修复也来得及。当前实现对所有 author 重叠组合（仅 prev / 仅 new / prev∩new / 都没有）都给出**正确终态**。

**实际等级:** Info（可读性微改）。

---

### C-2 ❌ 原 1.2 「DFS 候选未去重 High」 — **不是 Bug**

DFS 内已用 `visited` 数组：
```solidity
if (_isInArray64(current, visited, visitedCount)) continue;
visited[visitedCount++] = current;
```
每个 chapter 至多入 leaves 一次。在 tree 结构下不可能同节点多路径到达；DFS 实现本身保证唯一性。

**实际等级:** Info。原报告的「未来 DFS 出 bug」属推测。

---

### C-3 ❌ 原 1.3 「_walkAndSetAuthorFlag 校验顺序 High」 — **原报告误读代码**

原报告称「先写后查」，实际代码：
```solidity
DataTypes.Chapter storage ch = _chapters[current];
if (ch.novelId != novelId) break;        // ← 检查在前
isWorldLineAuthor[novelId][ch.author] = flag;  // 写在后
```

无效 chapter 的 `ch.novelId == 0`，传入的 novelId > 0（novel id 从 1 开始），check 直接 break，**不会写**任何 storage。

**实际等级:** Info（无 Bug）。

---

### C-4 ❌ 原 1.6 「settleRound winners 未校验 Medium」 — **已被隐式校验**

`_collectEligibleNewAuthors` 对每个 winner 调 `_findCandidateIndex(rd, winners[w])`，找不到就 `revert NotACandidate(chapterId)`。

settleRound 流程中若 VotingEngine 返回非 candidate ID，整个交易 revert。**已防御**。

**实际等级:** Info。

---

### C-5 ❌ 原 2.5 「VotingEngine.receive 升级窗口 Medium」 — **运维问题**

属升级流程 runbook 范畴，不是合约层 Bug。文档化即可。

**实际等级:** Info。

---

### C-6 ❌ 原 2.6 「nominateCandidate 缺 nonReentrant Medium」 — **当前安全**

CEI 顺序正确，PrizePool.deposit 无外部 call 不可重入。可加 belt-and-suspenders 但非必须。

**实际等级:** Info。

---

### C-7 ❌ 原 2.8 「startRound 缺 nonReentrant Low」 — **当前安全**

同上，CEI + phase 自检防止重入二次启动。

**实际等级:** Info。

---

## D 类：Gas / 风格优化（保留原报告，纯加分）

### D-1 [Medium] DFS 重复 EXTCALL（_dfsDeepestChains）

DFS 对每个节点 `getChapter(current)`，又对每个 child `getChapter(kids[d]).novelId`。500 节点 × 平均 2 = 1000 次 EXTCALL × ~2600 gas = ~2.6M gas。

**优化方案:** 在 NovelCore 暴露批量 view `getChaptersMinimal(uint64[] ids) returns ((uint64 novelId, uint32 depth, uint64[] children)[])`，DFS 一次拉一批。或缓存已 fetch 的 chapter 信息到 memory。

**性价比:** 高。startRound 是 keeper-paid 操作，省 ~1-2M gas。

---

### D-2 [Low] `_walkAndSetAuthorFlag` 同值重复 SSTORE

同一作者出现在 walk 路径上 N 次会写 N 次 SSTORE。EIP-2929 后写同值 ~100 gas，但累积。可用 memory 集合去重作者。**性价比一般**。

---

### D-3 [Low] `unchecked` 缺失

排序、累加、明显安全的算术可加 unchecked。**性价比低，散弹优化**。

---

### D-4 [Info] 过时注释

VotingEngine 多处注释还说 "called by NovelCore"，应改 "RoundManager"。

---

### D-5 [Info] receive() 检查模式不一致

NovelCore 只允许 prizePool；RoundManager 允许 prizePool / votingEngine。各自对，但建议每个加注释「谁会向我转 ETH 及为什么」。

---

## 重排后的最终汇总

| 优先级 | 项 | 性质 | 修复成本 |
|--------|----|------|---------|
| 🔴 必修 | A-1 DFS storage 数组反复扫描 | gas OOG 风险 | 单函数改 |
| 🟠 应修 | A-2 path-walk 静默截断 | 长期非确定性 | revert 改写 |
| 🟠 应修 | A-3 tipChapter 失败转 pending | 作者利益 | 单分支改 |
| 🟠 应修 | A-4 distributeRoundRewards 加 nonReentrant | 防御纵深 | 一行 |
| 🟡 建议 | B-1 applyWorldLineSettlement 输入校验 | 防御纵深 | 几行 |
| 🟡 建议 | B-2 admin setter 加 event | 可观测性 | 多处一行 |
| 🟡 建议 | B-3 OnlyNovelCore 错误改名 | 可读性 | 一行 |
| 🟢 加分 | D-1 DFS gas 优化 | 性能 | 中等重构 |
| 🟢 加分 | D-2 ~ D-5 | 风格/微 gas | 低 |
| ⚪ 不修 | B-4 ~ B-5 | 运维/防御 | — |
| ⚪ 撤销 | C-1 ~ C-7 | 原报告误判 | — |

---

## 我的建议

**部署前必须做：A-1**（这条不修必出事）

**升级前应做：A-2 / A-3 / A-4 + B-1 / B-2 / B-3**

**有空再做：D-1 + D-2 ~ D-5**

不必做：B-4 / B-5（运维注意）、C-1 ~ C-7（误判）

请告诉我哪些动手、哪些保留。
