# 智能合约审计报告 v2

**审计范围:** 拆分后的 7 个合约 + 1 个库 + 6 个接口（`src/` 目录）
**审计日期:** 2026-04-14
**重点维度:** 1) 代码逻辑正确性 2) 简洁性 3) 安全漏洞 4) Gas 优化

---

## 概览

| # | 文件 | 大小 (B) | 角色 |
|---|------|---------:|------|
| 1 | NovelCore.sol      | 18,331 | novel/chapter/world-line 状态 + 特权 setter |
| 2 | RoundManager.sol   | 18,066 | 轮次生命周期 + DFS + 投票编排 + 完结 |
| 3 | VotingEngine.sol   |  7,540 | commit-reveal 投票、tally、奖励 |
| 4 | PrizePool.sol      |  6,282 | 奖池 + 打赏 + 奖励分配 |
| 5 | BountyBoard.sol    |  7,102 | 直接子章节悬赏 |
| 6 | RulesEngine.sol    |  8,250 | 世界观规则治理 |
| 7 | UserRegistry.sol   |    294 | 一次性昵称（独立非升级）|

均 ≤ EIP-170 限。

---

## 1. 代码逻辑正确性

### 1.1 [Critical] `applyWorldLineSettlement` 双 author 路径竞态

**位置:** `NovelCore.sol:305-332`

**问题:** 函数先 walk `prevAncestors` 全部清 `isWorldLineAuthor[a]=false`，再 walk `newAncestors` 全部置 `=true`。当某作者同时在 prev 和 new 路径上时，最终值正确（被覆盖为 true）。但若未来在两个 walk 中间引入任何外部调用 / 重入，会出现「该作者短暂为 false」的不一致状态。

**修复建议:** 改为「差集更新」语义 —— 先收集 newAuthors 集合，再 walk prevAncestors 时只清那些 **不在 newAuthors 中** 的作者。这样语义无副作用、对未来扩展更鲁棒。

---

### 1.2 [High] DFS 候选未去重

**位置:** `RoundManager.sol:_dfsDeepestChains` + `startRound:136-139`

**问题:** DFS 内部用 `visited` 集合去重节点，但返回 `candidates` 后 `startRound` 直接 push 进 `rd.candidates`，没二次去重。当前 tree 结构下不应有重复，但若 DFS 实现未来出错（visited 校验失败），同一 chapter 可能进入候选列表两次 → 投票权重翻倍。

**修复建议:** 在 push 前显式去重；或在 DFS 末尾断言 `candidateIds` 无重复。

---

### 1.3 [High] `_walkAndSetAuthorFlag` 检查顺序不防御

**位置:** `NovelCore.sol:339-348`

**问题:** 函数先读 `ch = _chapters[current]`，再判断 `ch.novelId != novelId`，再设置 `isWorldLineAuthor[novelId][ch.author] = flag`。当 `current` 是无效 ID（chapter 不存在），`ch.author == address(0)`，会写 `isWorldLineAuthor[novelId][address(0)] = true/false`，污染状态。

**修复建议:** 增加 `if (ch.id == 0 || ch.novelId != novelId) break;` 在写之前。

---

### 1.4 [Medium] `_collectEligibleNewAuthors` 中 `_isInArrayMem` 嵌套 O(n²)

**位置:** `RoundManager.sol:456-489`

**问题:** 每个 winner walk 时都对 `rd.prevWorldLines` 做 O(n) 线性查找。最坏 winners=16 × steps=500 × prevWorldLines=16 ≈ 128K 比较。对应大量 SLOAD（prevWorldLines 是 storage）。

**修复建议:** walk 开始前把 `rd.prevWorldLines` 拷贝到 memory 缓存；或在 RoundData 加 `mapping(uint64 => bool) isPrevWorldLine` 用 O(1) 查表。

---

### 1.5 [Medium] `tipChapter` 推送失败时全额转 pool — 作者损失意图

**位置:** `PrizePool.sol:148-165`

**问题:** 若作者地址是合约且 `receive` revert，作者那 50% 分成被全额并入奖池而非保留。攻击向量：恶意作者刻意用 revert 合约接收，迫使所有打赏 100% 进入池（个人不拿钱，集体获益）。反向也成立：恶意第三方部署一个 receive-revert proxy 抢断作者收益（在 fork novel 场景）。

**修复建议:** 推失败时 fall back 到 pull 模式：`_pendingRewards[novelId][author] += authorShare;` 而非全转池。语义保持「作者拿 50%」。

---

### 1.6 [Medium] `settleRound` 不验证 winners 来自当前候选集

**位置:** `RoundManager.sol:settleRound:189`

**问题:** `votingEngine.tallyVotes` 返回 winners 后直接走奖励/世界线流程，未检查 `winners ⊆ rd.candidates`。若 VotingEngine 未来 bug / 升级失误返回非候选 ID，会写入错误的世界线祖先并污染 isWorldLineAuthor。

**修复建议:** 加 sanity check 循环验证每个 winner 都在 `rd.candidates` 中。

---

### 1.7 [Medium] `MIN_TREE_WALK_STEPS` 截断未抛错

**位置:** `NovelCore._walkAndSetAuthorFlag` + `RoundManager._collectPathAuthors / _isDescendantOfWorldLine / _collectEligibleNewAuthors`

**问题:** path-walk 函数都用 `for (step < MAX_*_STEPS && current != 0)` 兜底。若达到上限，walk 静默退出 → 部分作者标志未被清/设、部分作者奖励漏发。深度超 500/1000 的小说会出现非确定性结果。

**修复建议:** 退出循环时若 `step == MAX_* - 1` 则 revert，强迫 owner 调高上限或切分。或文档明确"小说最大深度受 walk-step 上限约束"。

---

## 2. 安全漏洞

### 2.1 [High] `PrizePool.distributeRoundRewards` 缺少 `nonReentrant`

**位置:** `PrizePool.sol:222-258`

**问题:** 该函数：
1. 更新 `_pendingRewards`（state）
2. `_poolBalances[novelId] -= releaseAmount`（state）
3. `msg.sender.call{value: voterRewards}("")` —— 把 voterRewards 转给调用方（RoundManager）
4. emit event

虽然 state 在 call 之前已更新（CEI 顺序正确），但缺少 `nonReentrant`。如果 RoundManager 的 receive() 被换成恶意实现并能再次进入 `distributeRoundRewards`，理论上能被攻击。

**修复建议:** 加 `nonReentrant` 修饰符兜底。成本极小（一次 SSTORE），换 belt-and-suspenders。

---

### 2.2 [High] NovelCore 初始化未带 roundManager → 部署时间窗

**位置:** `NovelCore.sol:75-88` + `Deploy.s.sol:73`

**问题:** `initialize()` 不接受 `roundManager_`。部署后必须 owner 单独调用 `setRoundManager`。两步操作之间存在时间窗——这期间任何 round 相关 setter 都因 `msg.sender != address(0)` 而 revert，但小说创建照常。如果 owner 忘了第二步，整个轮次系统不可用，且无显式报错。

**修复建议:** initialize 可接受 0 地址做占位，但建议在 Deploy.s.sol 严格的 atomic broadcast 中确保 setRoundManager 必调；或把 roundManager 作为 init 必填参数（要求 RoundManager 先部署，但 RoundManager init 也需要 NovelCore 地址 → 需要循环初始化模式）。当前的 setter 模式是合理折中，但建议在 NovelCore 自身加一个 `roundManagerSet` 事件并允许只读检查方法 `bool isFullyInitialized()`。

---

### 2.3 [Medium] `setRoundManager` 不发事件

**位置:** `NovelCore.sol:113-116`

**问题:** owner 调用 `setRoundManager` 不 emit 事件。审计/索引器无法追踪 RoundManager 替换历史。其他 setter（`setVotingEngine` 等）同样无 event。

**修复建议:** 所有 admin setter 加 `event ConfigUpdated(string what, address oldAddr, address newAddr)` 或对应单独事件。

---

### 2.4 [Medium] `applyWorldLineSettlement` 完全信任 RoundManager 传入数据

**位置:** `NovelCore.sol:305-332`

**问题:** RoundManager 传入 `prevAncestors` / `newAncestors`，NovelCore 不做任何校验：
- newAncestors 是否真的属于 novelId？
- prevAncestors 是否就是 NovelCore 当前 `_worldLineAncestors[novelId]`？

若 RoundManager 升级为恶意实现，可任意修改世界线和作者标志。这是 trust 模型设定，但应在合约层做最低限度校验。

**修复建议:** 至少校验 `newAncestors` 中每个 chapterId 的 `_chapters[id].novelId == novelId`。`prevAncestors` 可不校验（用于 walk 清旧标志即可，错误也只清错而非坏）。

---

### 2.5 [Medium] VotingEngine.receive 未限制金额或来源验证

**位置:** `VotingEngine.sol:369-371`

```solidity
receive() external payable {
    if (msg.sender != roundManager) revert OnlyRoundManager();
}
```

**问题:** 仅限 RoundManager。若 RoundManager 升级被替换，旧的 RoundManager 残留的 ETH 流入会被拒；但更大的风险是：若 owner 忘了调用 `setRoundManager(newAddr)`，旧 RoundManager 仍能给 VotingEngine 转钱，造成 stake/reward 错配。

**修复建议:** 配套补救：升级 RoundManager 前 owner 必须先 pause 所有合约。文档中明确升级 runbook。

---

### 2.6 [Medium] `nominateCandidate` 重入保护缺失

**位置:** `RoundManager.sol:nominateCandidate:240-270`

**问题:** 该函数：
1. 校验 phase
2. 调 `novelCore.getChapter`（view，无害）
3. 写 `rd.candidates / rd.candidateIsEligible`
4. 调 `votingEngine.addCandidate`
5. `prizePool.deposit{value:...}`

后两个是外部 CALL。虽然都是已知合约且本身有 nonReentrant，但 `nominateCandidate` 自己没 `nonReentrant`。若任一外部合约被恶意升级 → 可重入 nominateCandidate 重复加 candidate。

**修复建议:** 加 `nonReentrant`。

---

### 2.7 [Low] `claimReward` / `claimVotingReward` 转发缺少 reentry 防护

**位置:** `NovelCore.claimReward:262-265` / `RoundManager.claimVotingReward:300-303`

**问题:** 这些只是 `prizePool.claimReward()` / `votingEngine.claimVotingReward()` 的转发；底层有 `nonReentrant` 防护，外层也加了 `nonReentrant`。OK，但需要持续验证两层 reentrancy guard 各自存在 —— 任一被移除即裸奔。

**建议:** 添加测试 `test_double_layer_reentrancy_guard` 锁死契约。

---

### 2.8 [Low] `_payKeeper` 在 `nonReentrant` 函数末尾调用第三方

**位置:** `RoundManager.sol:520-523`

**问题:** `_payKeeper` 调 `prizePool.payKeeperReward`，这是个外部 call。settleRound / closeNomination / closeCommit / startRound 在末尾调用，但它们都已是 `nonReentrant`（settleRound）或者只读（其他三个不写自己 state 后调）。基本安全，但 startRound 不是 `nonReentrant` 修饰的（仅 whenNotPaused），且在写完 rd.candidates 后才调 `_payKeeper` —— 若 PrizePool 升级恶意可重入 startRound 二次启动同 novel 导致状态破坏。

**修复建议:** `startRound` / `closeNomination` / `closeCommit` 加 `nonReentrant`。

---

## 3. 简洁性 / 模块化

### 3.1 [Info] VotingEngine 中过时注释

**位置:** `VotingEngine.sol` 多处

注释提到 "called by NovelCore"，应改 "called by RoundManager"（结构体重命名 `novelCore → roundManager` 时漏改注释）。

---

### 3.2 [Info] receive() 检查模式不一致

NovelCore: 仅 prizePool。
RoundManager: prizePool 或 votingEngine。

当前正确，但建议各自加一行注释列出 **谁会向我转 ETH、为什么**，避免未来误读。

---

### 3.3 [Low] PrizePool `OnlyNovelCore` 与 `OnlyRoundManager` 错误命名混用

**位置:** `PrizePool.sol` deposit 函数

```solidity
if (msg.sender != novelCore && msg.sender != roundManager && ...) revert OnlyNovelCore();
```

revert 用 `OnlyNovelCore()` 但实际接受 4 种来源。错误命名让前端解错误码时困惑。

**修复建议:** 改为 `OnlyAuthorizedDepositor()` 或类似。

---

### 3.4 [Info] DataTypes 库未集中事件定义

事件分散在各合约，导致 `RewardClaimed` 在 NovelCore、RoundManager、PrizePool、VotingEngine 都有定义（不同 selector 因 contract address 不同）。前端/索引器需要分别注册。

**建议:** 接受现状（单一 source 让 emit 简单），但文档明确「同名事件可能跨合约出现」，索引器按 source 合约区分。

---

### 3.5 [Info] `_initNovelAndRoot` 内联化未必有必要

`NovelCore._initNovelAndRoot` 是从 `createNovel` / `forkNovel` 提取出的私有 helper。via_ir 大概率会再次 inline 它，提取为 helper 不带来字节码节省，主要是可读性收益。保留 OK。

---

## 4. Gas 优化

### 4.1 [Medium] DFS 中重复 `getChapter` 外部调用

**位置:** `RoundManager._dfsDeepestChains:407 + 411`

DFS 内对每个候选节点调 `novelCore.getChapter(current)`（一次），随后又对每个 child 调 `novelCore.getChapter(kids[d])`（看 novelId）。当 child 在后续迭代被 pop 时再调一次 getChapter（重复读自己）。500 节点 × 平均 2 次 = 1000 次 EXTCALL，每次 ~2600 gas（cold）= 2.6M gas。

**修复建议:** 维护 memory 中的 `mapping`（用 `uint64[] visitedIds` + 平行 `uint64[] visitedNovelIds + uint32[] visitedDepths + uint64[][] visitedChildren` 数组），避免重复 fetch。或者在 NovelCore 加 batch view `getChapters(uint64[] ids) returns (Chapter[])`，单次 EXTCALL 拿一批。

预计省 1-2M gas（startRound 调用方付）。

---

### 4.2 [Low] `_isInArrayMem` 把 storage 数组当 `memory` 错命名

**位置:** `RoundManager.sol:539-544`

```solidity
function _isInArrayMem(uint64 val, uint64[] storage arr) internal view returns (bool) {
```

形参是 `storage` 但函数名是 `_isInArrayMem`。误导阅读者，且每次调用对 storage 数组扫描。建议改名 `_isInArrayStorage` 并先把 `arr` 拷贝到 memory（如调用频率高）。

---

### 4.3 [Low] `_walkAndSetAuthorFlag` 重复写同值

`isWorldLineAuthor[novelId][ch.author] = flag;` —— 若该作者在路径上出现 N 次（即 N 个章节都是同一作者），会写 N 次同样的值。除第一次外都浪费 SSTORE。

**修复建议:** 用 memory 集合记已写过的作者，跳过重复。但路径平均不会太重复，节省有限。

---

### 4.4 [Low] `unchecked` 缺失

多处明显安全的算术未用 `unchecked`：
- `RoundManager._dfsDeepestChains` 排序循环：`leafDepths[j-1]` 读、`j--`
- `VotingEngine.tallyVotes` 累加权重
- `PrizePool.distributeRoundRewards` 减法已有上下界保证

**修复建议:** 评估每处加 unchecked，预计省 5-10K gas/round。

---

### 4.5 [Low] `BountyBoard._getQualifyingAuthors` O(n²) 去重

**位置:** `BountyBoard.sol:328-345`

子章节去重双循环。子节点数 < 256（合约内有 cap），实际可控。但若希望省 gas 可考虑用 `bytes32[]` 标记数组替代，或排序后扫一遍。

**修复建议:** 当前可接受，不强求优化。

---

### 4.6 [Info] 热路径函数未标 `external` 而非 `public`

抽样查看，所有 user-facing 函数都标 `external`，OK。`internal` / `private` 标注合理。

---

## 汇总表

| # | 级别 | 类别 | 位置 | 主题 |
|---|------|------|------|------|
| 1.1 | Critical | 逻辑 | NovelCore.sol:305 | 世界线 author flag 双路径覆盖语义 |
| 1.2 | High | 逻辑 | RoundManager.sol startRound | DFS 候选未去重 |
| 1.3 | High | 逻辑 | NovelCore.sol:339 | _walkAndSetAuthorFlag 校验顺序 |
| 1.4 | Medium | 逻辑 | RoundManager.sol:456 | _collectEligibleNewAuthors 嵌套查找 |
| 1.5 | Medium | 逻辑 | PrizePool.sol:148 | tipChapter 推送失败转池 |
| 1.6 | Medium | 逻辑 | RoundManager.sol settleRound | winners 子集校验 |
| 1.7 | Medium | 逻辑 | path-walk helpers | walk 截断静默 |
| 2.1 | High | 安全 | PrizePool.sol distributeRoundRewards | 缺 nonReentrant |
| 2.2 | High | 安全 | NovelCore initialize | 部署时间窗 |
| 2.3 | Medium | 安全 | NovelCore.sol setRoundManager | 缺事件 |
| 2.4 | Medium | 安全 | NovelCore applyWorldLineSettlement | 不校验输入 |
| 2.5 | Medium | 安全 | VotingEngine.receive | 升级窗口 |
| 2.6 | Medium | 安全 | RoundManager.nominateCandidate | 缺 nonReentrant |
| 2.7 | Low | 安全 | claimReward 转发 | 双层防护脆弱 |
| 2.8 | Low | 安全 | startRound | 缺 nonReentrant |
| 3.1 | Info | 简洁 | VotingEngine | 过时注释 |
| 3.2 | Info | 简洁 | receive() | 不一致 |
| 3.3 | Low | 简洁 | PrizePool error | 命名误导 |
| 3.4 | Info | 简洁 | DataTypes | 事件分散 |
| 3.5 | Info | 简洁 | _initNovelAndRoot | 内联收益小 |
| 4.1 | Medium | Gas | DFS | 重复 EXTCALL |
| 4.2 | Low | Gas | _isInArrayMem | 命名误导 + storage 扫描 |
| 4.3 | Low | Gas | _walkAndSetAuthorFlag | 同值重复写 |
| 4.4 | Low | Gas | 多处 | unchecked 缺失 |
| 4.5 | Low | Gas | BountyBoard 去重 | O(n²)（可接受） |

---

## 优先级建议

**部署前必修：**
- 1.3（_walkAndSetAuthorFlag 校验顺序）：直接污染 storage，单行修复
- 2.1（distributeRoundRewards 加 nonReentrant）：兜底防护，单行修复
- 2.4（applyWorldLineSettlement 输入校验）：信任边界，加几行 require

**第一个升级：**
- 1.1（applyWorldLineSettlement 差集语义）：重构清晰、防御未来扩展
- 1.2（DFS 候选去重）：投票完整性
- 1.5（tipChapter pull-fallback）：作者收益保护
- 1.6（settleRound winners 校验）：跨合约信任收紧
- 2.6 + 2.8（nominateCandidate / startRound 加 nonReentrant）

**长期改进：**
- 1.7（path walk 截断 revert）
- 4.1（DFS gas 优化）
- 3.x（命名/注释/事件统一）

---

## 总评

架构清晰、模块化合理、UUPS 升级模式标准、CEI 与 nonReentrant 大体到位。主要风险集中在：

1. **跨合约信任边界** 的输入校验偏弱（NovelCore 完全信任 RoundManager 输入）
2. **path-walk 截断的静默语义**，在深度异常的 novel 中可能产生非确定性
3. **少数 nonReentrant 缺漏**，目前依靠下游合约保护，不够鲁棒

修复后可视为 **生产就绪** 级别。
