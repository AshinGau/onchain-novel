# 智能合约审计报告
## 去中心化协作小说协议（Decentralized Collaborative Novel Protocol）

**审计范围：** `/src/` 下的五份 UUPS 可升级合约及 DataTypes 库
- `NovelCore.sol` — 章节树、轮次生命周期、worldLineAncestors、DFS 候选生成
- `VotingEngine.sol` — commit-reveal 投票、准确度 3x 权重
- `PrizePool.sol` — 创作者 royalty、作者/投票者奖励、打赏、keeper 奖励
- `BountyBoard.sol` — 读者悬赏、20% 归池 / 80% 归作者或退款
- `RulesEngine.sol` — 世界观规则：创作者规则 + 提案治理
- `libraries/DataTypes.sol`

**审计日期：** 2026-04-13
**审计维度：** 流程与逻辑 Bug / 安全问题 / 模块清晰度 / Gas 优化

---

## 一、问题汇总

| 严重程度 | 数量 | 说明 |
|----------|------|------|
| Critical | 1    | 直接影响资金分配正确性或治理有效性，需上线前修复（C-1/C-2/C-3 经复核已撤销） |
| High     | 4    | 会导致资金泄漏、状态损坏或候选集偏差 |
| Medium   | 4    | 边界/效率问题，建议尽快修复 |
| Low      | 3    | 可用性/健壮性改进 |
| Info     | 5    | Gas 与代码质量优化建议 |

---

## 二、Critical 级别

### C-1. VotingEngine：投票奖励权重重复计入 accurate stake

**位置：** `VotingEngine.sol:304`

```solidity
uint256 totalWeight = rd.totalRevealedStake + rd.totalAccurateStake * 2;
```

**问题分析：**
根据设计文档，准确投票（投给最终胜出世界线的投票）应获得 **3 倍权重**，其他已揭示投票获得 1 倍权重。

当前实现中，`totalAccurateStake` 本身已经是 `totalRevealedStake` 的**子集**（准确投票者的质押在 reveal 阶段已计入 `totalRevealedStake`）。因此：

- 分子端 `myWeight`（单人）对准确投票者正确返回 3x（见 `VotingEngine.sol:315` 附近）
- 分母端 `totalWeight` 却是 `revealed + accurate*2`，等效于准确票 3x + 非准确票 1x —— 看似正确

**乍看没问题，但实际的 Bug 在于：** 当**全部** reveal 者都是准确投票时，`totalRevealedStake == totalAccurateStake`，分母变成 `3x`；而此时每个人 `myWeight` 也是 `3x stake`，所以分到的奖励是 `reward = pool * 3s / (3S) = pool * s/S`，这部分正确。

**真正的 Bug 在另一种情况：** 当部分人准确、部分人不准确时，由于 `totalAccurateStake` 被**加**而不是**替换**计入，实际权重分布是正确的。

**进一步复核：**
- 非准确投票者权重 1x：分到 `pool * stake / totalWeight`
- 准确投票者权重 3x：分到 `pool * 3*stake / totalWeight`
- totalWeight = 非准确 stake 总和 × 1 + 准确 stake 总和 × 3
- 而当前公式 `revealed + accurate*2` = (非准确 + 准确) + 准确×2 = 非准确×1 + 准确×3 ✅

**结论修正：** 该公式**数学上等价于正确写法**，不构成 Bug。但可读性差，建议改写为更直观的形式：

```solidity
uint256 totalWeight = (rd.totalRevealedStake - rd.totalAccurateStake)
                    + rd.totalAccurateStake * 3;
```

**严重程度下调：** Info（代码可读性），**非 Critical**。原报告此处为误判，特此更正。

---

### C-2. ~~BountyBoard：合格作者未过滤为「直接子章节」~~ — **误报，已撤销**

**重新核实：** `NovelCore.sol:385` 中 `_chapters[parentId].descendants.push(chapterId)` 仅把章节推入**直接父节点**的 `descendants` 数组。该字段存储的就是「直接子节点」而非整棵子树。`getChapterDescendants` 语义正确，`BountyBoard._getQualifyingAuthors` 的行为符合设计。

**结论：** 不存在此 Bug。原报告对字段语义判断错误，特此撤销。

（命名上 `descendants` 容易让读者误以为是「所有后代」，可考虑重命名为 `children`，属 Info 级别的可读性建议。）

---

### C-3. BountyBoard：清扫函数的整除余数（dust）永久锁死

**位置：** `BountyBoard.sol:275-283` (`sweepUnclaimedBounty`)

```solidity
uint256 perShare = bounty.lockedAmount / qualifyingCount;
uint256 totalClaimed = 0;
for (uint256 i = 0; i < qualifyingCount; i++) {
    if (_hasClaimed[bountyId][qualifyingAuthors[i]]) {
        totalClaimed += perShare;
    }
}
remaining = bounty.lockedAmount - totalClaimed;
```

**问题分析：**
整除 `lockedAmount / qualifyingCount` 会丢弃余数 `dust = lockedAmount % qualifyingCount`。当 claim 函数将 dust 发给「最后一个 claimer」（见 `claimBounty` 230 行附近逻辑）时工作正确，但当**部分作者未 claim、由 sweep 退款**时：

- `totalClaimed = perShare × 已 claim 人数`（未包含 dust，因为最后一人未 claim）
- `remaining = lockedAmount - totalClaimed` → 含有本应属于未 claim 者的那份 `perShare + dust`
- tipper 此时**多领了 dust**，而未 claim 的作者本应是 `perShare + dust` 的那一份被合并退给 tipper

**具体影响分两种：**
1. 若 sweep 时最后 claim 者没拿到 dust：dust 回到 tipper（相对公平，但偏离「最后 claimer 得 dust」语义）
2. 若实现不一致，存在 1 wei 级别资金错配

实际代码语义：dust 永远由「最后一个 claim 的人」拿到；若没人全部 claim，dust 随 `remaining` 退回 tipper。这**并不构成资金丢失**，但文档与实现语义需一致。

**严重程度修正：** Low（语义清晰性），非 Critical。

**修复建议：** 明确注释 dust 归属语义，或统一计算：
```solidity
uint256 perShare = bounty.lockedAmount / qualifyingCount;
uint256 dust = bounty.lockedAmount % qualifyingCount;
// 明确：未 claim 份额 + dust 一同退回 tipper
```

---

### C-4. RulesEngine：删除不存在的规则，提案被静默标记为已执行

**位置：** `RulesEngine.sol:181-183`

```solidity
if (proposal.proposalType == DataTypes.RuleProposalType.Add) {
    _setRule(novelId, proposal.ruleName, proposal.ruleContent);
} else if (_ruleNameIndex[novelId][proposal.ruleName] != 0) {
    _deleteRule(novelId, proposal.ruleName);
}
// 无 else：规则不存在时什么也不做，但仍然会走到下面 emit
emit RuleProposalExecuted(proposalId, novelId);
```

**问题分析：**
- 攻击者提交「删除一条从未存在的规则」的治理提案
- 花费提案费 → 通过世界线作者投票（若被集体忽略或误通过）
- 合约「成功」执行，但实际没有任何状态变更，事件却显示 executed

**影响：**
- 治理资源被消耗（提案费、投票人 gas）
- 事件与状态不一致，索引器与前端会显示错误的「规则已删除」
- 在多并发提案场景下，可能被利用构造混淆

**修复建议：**
```solidity
if (proposal.proposalType == DataTypes.RuleProposalType.Add) {
    _setRule(novelId, proposal.ruleName, proposal.ruleContent);
} else {
    if (_ruleNameIndex[novelId][proposal.ruleName] == 0) {
        revert RuleNotFound(proposal.ruleName);
    }
    _deleteRule(novelId, proposal.ruleName);
}
emit RuleProposalExecuted(proposalId, novelId);
```

也可以在 `createRuleProposal` 时就校验 Delete 提案的目标规则存在。

---

## 三、High 级别

### H-1. NovelCore：DFS 候选生成被 `nodeLimit` 静默截断

**位置：** `NovelCore.sol:859-952` (`_dfsDeepestChains`)

```solidity
uint32 nodeLimit = maxDfsNodes > 0 ? maxDfsNodes : 500;
while (stackTop > 0 && nodesVisited < nodeLimit) { ... }
```

**问题分析：**
当章节树节点数超过 `nodeLimit`，DFS 会在遍历途中退出。此时：
- 已遍历分支的叶子被收集，未遍历分支被完全忽略
- 后加入、深度较大的章节系统性失去参与轮次的机会
- 候选集被偏向于「先遍历到」的分支

**影响：**
- 候选生成不完整 → 轮次不公平
- 作者的劳动价值与章节位置耦合
- 攻击者可以通过操纵 `descendants[]` 顺序影响候选选择

**修复建议（二选一）：**

**A. 严格模式：** 截断时直接 revert，强制 owner 提升 `maxDfsNodes`：
```solidity
if (stackTop > 0) revert DFSTruncated();
```

**B. 可分页：** 将 `startRound` 拆分为 `prepareRound`（多次调用推进 DFS）+ `finalizeRound`，把长任务摊薄到多笔交易。

推荐 A，简单可靠；B 留作后续。

---

### H-2. PrizePool：作者奖励整除余数（dust）永久丢失

**位置：** `PrizePool.sol:224-232`

```solidity
uint256 authorRewards = (remaining * (10000 - voterRewardRate)) / 10000;
if (authorRewards > 0) {
    uint256 perAuthorReward = authorRewards / authors.length;
    if (perAuthorReward > 0) {
        for (uint256 i = 0; i < authors.length; i++) {
            _pendingRewards[novelId][authors[i]] += perAuthorReward;
        }
    }
    authorRewards = perAuthorReward * authors.length;  // dust 丢失
}
```

**问题分析：**
每轮结算，`authorRewards % authors.length` 的余数被丢弃，进入无人认领的状态。长期累积会产生可观损耗，也违反「资金守恒」不变量。

**修复建议：** 将 dust 显式归属（推荐给 creator 或保留在 pool）：
```solidity
uint256 perAuthorReward = authorRewards / authors.length;
uint256 dust = authorRewards % authors.length;
for (uint256 i = 0; i < authors.length; i++) {
    _pendingRewards[novelId][authors[i]] += perAuthorReward;
}
if (dust > 0) {
    _pendingRewards[novelId][creator] += dust;   // 或 _poolBalances[novelId] += dust;
}
```

---

### H-3. NovelCore：世界线作者标记在路径遍历截断时可能损坏

**位置：** `NovelCore.sol:568-576` (`settleRound`)

```solidity
delete _worldLineAncestors[novelId];
_clearWorldLineAuthors(novelId, rd.prevWorldLines);
// ...
for (uint256 i = 0; i < selectCount; i++) {
    _worldLineAncestors[novelId].push(winners[i]);
}
_setWorldLineAuthors(novelId, winners);
```

**问题分析：**
- `_clearWorldLineAuthors` / `_setWorldLineAuthors` 需要沿 `parentId` 回溯整个链，受 `MAX_TREE_WALK_STEPS` 上限保护
- 如果某条路径长度超过上限，遍历将提前终止：
  - clear 阶段截断 → 仍残留 `_isWorldLineAuthor = true` 的幽灵作者
  - set 阶段截断 → 合法作者被漏设
- 进而影响 `RulesEngine` 中世界线作者投票资格

**影响：** 治理投票资格被错误判定，且错误状态会跨轮次累积（下一轮 clear 又基于错误的 prev 状态）。

**修复建议：**
- 要么保证 `MAX_TREE_WALK_STEPS >= MAX_CHAPTER_DEPTH`（硬上限对齐）
- 要么采用「差集更新」：计算 `prev ∪ winners` 与 `prev ∩ winners`，只清理 `prev - winners`、只设置 `winners - prev`，避免先清再设的中间态风险
- 并在遍历到上限时 revert，而不是静默截断

---

### H-4. NovelCore ↔ VotingEngine：投票奖励结算缺少不变量检查

**位置：** `NovelCore.sol:543-565`、`VotingEngine.sol:273-336`

**流程：**
1. `NovelCore.settleRound` 把 `voterRewards + totalCommitted`（奖池 + 所有质押）一次性转给 `VotingEngine`
2. `VotingEngine.settleVoterRewards` 记账发放（refund + reward），返回 `excessReturn`
3. `NovelCore` 把 `excessReturn` 存回 `PrizePool`

**问题分析：**
`excessReturn` 只基于 reward 池剩余计算，不涵盖质押侧。若存在单人奖励上限（cap）或精度误差，VotingEngine 里可能沉淀 ETH：

- 入账：`voterRewardPool + totalPenalty + sum(refund)`
- 出账：`sum(refund + reward)`
- `excess`：仅按 `rewardPool - distributedReward` 计

如果某种边界情形下入账 ≠ 出账 + excess，差额就永久滞留合约。

**修复建议：** 在 `settleVoterRewards` 结尾加不变量断言：
```solidity
uint256 input = voterRewardPool + totalPenalty + totalRefundBase;
uint256 output = totalDistributedToVoters + excessReturn;
require(input == output, "VotingEngine: accounting mismatch");
```

同时考虑在 VotingEngine 添加一个紧急 sweep（仅 owner、仅非活跃轮次）以兜底。

---

## 四、Medium 级别

### M-1. VotingEngine：零 reveal 场景处理低效

**位置：** `VotingEngine.sol:273-336`

全员 commit 未 reveal 时，50% 质押罚金汇入 reward 池，但无投票者可领，整笔经 `excessReturn` 往返 `NovelCore → PrizePool`。结果正确但多一次状态读写与外部调用。可考虑快速路径：`if (totalRevealedStake == 0) return totalRewardPool;`。

---

### M-2. BountyBoard：deadline 边界的时间戳操纵

**位置：** `BountyBoard.sol:325`

`desc.timestamp <= bounty.deadline`：矿工在 ±12s 窗口内可影响边界章节是否合格。实际影响小，建议加 1s 缓冲或明确文档化。

---

### M-3. NovelCore：fork 费用下限等同 submission 费

**位置：** `NovelCore.sol:277-280`

```solidity
uint256 forkFee = sourcePoolBalance * FORK_FEE_RATE / BPS_DENOMINATOR;
if (forkFee < config.submissionFee) forkFee = config.submissionFee;
```

当 `sourcePoolBalance` 很小时，fork 费降到与新建小说相同。这使得「分叉一本有少量资金的小说」和「新建小说」成本一致，违反分叉应「更贵」的激励设计。建议引入独立的 `MIN_FORK_FEE` 或按 `submissionFee * k`（k > 1）设置下限。

---

### M-4. PrizePool：打赏作者推送失败被静默转入池

**位置：** `PrizePool.sol:148-156`

```solidity
(bool success,) = author.call{value: authorShare}("");
if (!success) {
    _poolBalances[novelId] += msg.value;   // 整笔 100% 进池，未发事件区分
} else {
    _poolBalances[novelId] += msg.value - authorShare;
}
emit ChapterTipped(novelId, chapterId, msg.sender, msg.value);
```

打赏者本意 50% 给作者，推送失败后静默把 100% 归入池。建议：
- 增加 `ChapterTipAuthorPushFailed` 事件；或
- 改为 pull 模式（`_pendingRewards[author] += authorShare`）彻底避免 push 失败

pull 模式更符合 CEI 与 rainy-day 设计。

---

## 五、Low 级别

### L-1. NovelCore：昵称不可修改
**位置：** `NovelCore.sol:839-843`
设置后永久锁定，无法更正错字。建议允许修改并发出 `NicknameUpdated` 事件。

### L-2. RulesEngine：规则内容无长度上限
**位置：** `RulesEngine.sol:26`
`string` 无界，大内容规则会推高 SSTORE 成本并膨胀状态。建议 `require(bytes(ruleContent).length <= 4096)`。

### L-3. NovelCore：metadata 仅校验 title
**位置：** `NovelCore.sol:1116-1118`
`description` / `coverUri` 无长度校验。建议分别上限 1024 / 512 字节。

---

## 六、Info / Gas 优化

### I-1. 去重循环 O(n²)
`BountyBoard.sol:334-345`、`VotingEngine.sol:261-266`。输入受 `MAX_PATH_CHAPTERS=256` 约束，可接受。若后续放宽上限，用 transient storage（EIP-1153）或临时 mapping 优化。

### I-2. 零地址校验缺失
除 `NovelCore.initialize` 外，多数 initialize / setter 未显式拒绝零地址。建议统一 `ZeroAddress` 自定义错误。

### I-3. UUPS `__gap` 需定期验证
当前各合约 gap：VotingEngine 49 / NovelCore 39 / PrizePool 50 / BountyBoard 50 / RulesEngine 43。每次升级前用 `forge inspect <Contract> storage-layout` 复核，防止存储槽冲突。

### I-4. 事件索引字段不全
- `ChapterSubmitted` 的 `author` 建议 `indexed`，便于后端按作者过滤
- `RoundSettled` 的 `round` 已 indexed，OK
- `RuleProposalExecuted` 可增加 `indexed novelId`（若未 indexed）

索引最多 3 个 topic，需权衡。

### I-5. `receive()` 白名单过严
`VotingEngine.sol:369-371`、`NovelCore.sol:1182-1184` 仅允许固定发送者。紧急注资、捐赠场景无法直接转入。可为 owner 提供白名单增删接口，保持安全的同时留出灵活性。

---

## 七、修复优先级建议

| 顺序 | 项目 | 理由 |
|------|------|------|
| 1 | C-4 | 治理提案执行正确性 |
| 2 | H-1, H-2, H-3 | 偏差、资金泄漏、状态损坏 |
| 3 | H-4 | 加 invariant 断言成本低、收益高 |
| 4 | M 系列 | 激励设计与 UX |
| 5 | L / I | 随常规迭代处理 |

> 注：原 C-1 重新复核为**代码可读性问题**而非 Bug，严重程度已下调到 Info。原 C-3 复核为**语义明确性**问题而非资金丢失，下调为 Low。本版本报告以此为准。

---

## 八、整体评估

- **架构清晰度：** 优。五合约职责分离明确，接口最小化。
- **安全实践：** 良好。CEI、nonReentrant、commit-reveal、UUPS gap 均到位。
- **主要改进方向：** DFS 截断、奖励 dust、路径遍历上限鲁棒性、治理提案执行校验。
- **上线前必修：** C-4、H-1、H-2、H-3。
- **建议补充：** 资金守恒不变量测试（property-based / invariant tests in Foundry）。
