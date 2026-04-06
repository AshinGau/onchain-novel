# MCP Server Lifecycle Test Plan (Multi-User, Compact)

> **⚠️ 本测试计划的核心目的是测试 MCP onchain-novel server 的工具调用能力。**
> **所有操作必须通过调用 MCP onchain-novel server 提供的 tool 来执行，禁止编写脚本或直接调用合约。**
> **每一步都应使用对应的 MCP tool（如 `create_novel`、`submit_chapter`、`voter_cast_vote` 等）。**

> 2 novels × 3 epochs × 2 rounds/epoch, 3 chapters/round, 7 roles.
> All duration = **1s** (except ruleVoteDuration).
> 测试覆盖: 创建、提交、投票、keeper推进、claim、tip、fork、rules、complete.

---

## Roles & Wallets

| Role | Key | Address |
|------|-----|---------|
| Creator | `0x59c6...690d` | 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 |
| Writer A | `0x5de4...365a` | 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC |
| Writer B | `0x7c85...07a6` | 0x90F79bf6EB2c4f870365E785982E1f101E93b906 |
| Voter A | `0x47e1...926a` | 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 |
| Voter B | `0x8b3a...ffba` | 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc |
| Keeper | `0x92db...564e` | 0x976EA74026E726554dB657fA54763abd0C3a0aa9 |
| Tipper | `0xac09...ff80` | 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 |

---

## Phase 0: Create 2 Novels [CREATOR]

> 使用 MCP tool: `switch_wallet` → `create_novel`

| # | title | bootstrap | initialPrizeEth | roundsPerEpoch | worldLineCount | roundMinSubmissions | stakeAmount | prizeReleaseRate | voterRewardRate |
|---|-------|-----------|-----------------|----------------|----------------|---------------------|-------------|------------------|-----------------|
| 1 | "Alpha" | ["Genesis: silence."] | "1.0" | 2 | 2 | 3 | "0.01" | 3000 | 1000 |
| 2 | "Beta" | ["Genesis: glass city."] | "2.0" | 2 | 2 | 3 | "0.02" | 2500 | 1500 |

**共同参数:**
```
minChapterLength: 1, maxChapterLength: 50000
roundMinDuration: 1, commitDuration: 1, revealDuration: 1
spamRounds: 3, spamThreshold: 20
contentLocation: 0, ruleFee: "0.001"
ruleVoteDuration: 259200, ruleQuorum: 2
```

**验证:** 每个小说 `get_novel` + `get_pool_balance`

---

## Phase 1: Set Creator Rules [CREATOR]

> 使用 MCP tool: `set_creator_rules` → `get_rules`

| Novel | rules |
|-------|-------|
| 1 | [{name:"setting", content:"Silent world"}, {name:"tone", content:"Mysterious"}] |
| 2 | [{name:"setting", content:"Glass city"}, {name:"protagonist", content:"Architect"}] |

**验证:** `get_rules` for each

---

## Phase 2: Epoch Loop (×3 epochs per novel)

> **所有操作均通过 MCP tool 逐步调用，不得编写自动化脚本。**
> 使用 MCP tools: `switch_wallet`, `get_active_world_lines`, `submit_chapter`, `keeper_check_and_advance`, `get_round_submissions`, `voter_cast_vote`, `voter_reveal`, `sweep_unrevealed`, `claim_voting_reward`, `claim_reward`, `get_pending_reward`, `get_pool_balance`

### 每个 Round 的标准操作 (roundsPerEpoch=2, 3 chapters/round)

```
1. get_active_world_lines(novelId) → 拿到 parentChapterId

2. [WRITER_A] submit_chapter × 2 (两条世界线各1篇)
     content: "n{N}_e{E}_r{R}_wA_{i}"
   [WRITER_B] submit_chapter × 1
     content: "n{N}_e{E}_r{R}_wB_{i}"
   (共 3 chapters 满足 roundMinSubmissions=3)

3. [KEEPER] keeper_check_and_advance  → close_submissions

4. get_round_submissions(novelId, epoch, round) → 拿到实际 chapterId 列表
   选择: Voter A → Writer A 的第1章, Voter B → Writer B 的第1章

5. [VOTER_A] voter_cast_vote(candidateId=WA_ch1, stakeEth=按投票策略)
   [VOTER_B] voter_cast_vote(candidateId=WB_ch1, stakeEth=按投票策略)
   (Epoch 1: A=0.05/B=0.03; Epoch 2: A=0.03/B=0.05; Epoch 3: 共识)

6. [KEEPER] keeper_check_and_advance  → close_commit

7. [VOTER_A] voter_reveal
   [VOTER_B] voter_reveal

8. [KEEPER] keeper_check_and_advance  → settle_round

9. [VOTER_A] sweep_unrevealed + claim_voting_reward
   [VOTER_B] claim_voting_reward
```

### Epoch 投票 (在 round 2 settle 后自动进入)

```
10. get_active_world_lines(novelId) → epoch 候选
    两个 voter 投同一条世界线(确保共识)

11. [VOTER_A] voter_cast_vote(isEpoch=true, candidateId=世界线A, stakeEth="0.1")
    [VOTER_B] voter_cast_vote(isEpoch=true, candidateId=同一世界线, stakeEth="0.08")

12. [KEEPER] keeper_check_and_advance  → close_epoch_commit

13. [VOTER_A] voter_reveal(isEpoch=true)
    [VOTER_B] voter_reveal(isEpoch=true)

14. [KEEPER] keeper_check_and_advance  → settle_epoch

15. 各角色 Claim:
    [CREATOR]  get_pending_reward → claim_reward
    [WRITER_A] get_pending_reward → claim_reward
    [WRITER_B] get_pending_reward → claim_reward
    [KEEPER]   get_pending_reward → claim_reward
    [VOTER_A]  claim_voting_reward × (round1 + round2 + epoch)
    [VOTER_B]  claim_voting_reward × (round1 + round2 + epoch)

16. get_pool_balance → 汇报奖池变化
```

### 投票策略

- **Epoch 1:** Voter A(0.05) → Writer A, Voter B(0.03) → Writer B → **Writer A wins** (高stake胜)
- **Epoch 2:** Voter A(0.03) → Writer A, Voter B(0.05) → Writer B → **Writer B wins** (反转stake，确保两个writer都有canon章节和收益)
- **Epoch 3:** Voter A/B 投同一章节(共识) → 测试一致投票

---

## Phase 3: Tip [TIPPER + others]

> 使用 MCP tool: `switch_wallet` → `tip_novel` → `get_pool_balance`

在 Epoch 2 完成后执行:

```
[TIPPER]   tip_novel(1, "0.5")
[TIPPER]   tip_novel(2, "1.0")
[VOTER_A]  tip_novel(1, "0.3")
[WRITER_A] tip_novel(2, "0.2")
```

每次 tip 后 `get_pool_balance` 验证。

---

## Phase 4: Rules Change [WRITER_A + WRITER_B]

> 使用 MCP tool: `switch_wallet` → `propose_rule` → `vote_on_rule_proposal` → `get_rules` → `get_rule_proposals`

在 Epoch 2 完成后(两个 writer 都有 canon 章节)执行:

```
[WRITER_A] propose_rule(novelId:1, type:"add", name:"twist", content:"Betrayal in every chapter")
[WRITER_B] vote_on_rule_proposal(proposalId) → quorum=2 达成，自动执行

[WRITER_B] propose_rule(novelId:2, type:"delete", name:"protagonist")
[WRITER_A] vote_on_rule_proposal(proposalId)

验证: get_rules + get_rule_proposals
```

---

## Phase 5: Fork [WRITER_B]

> 使用 MCP tool: `get_round_submissions` → `switch_wallet` → `fork_novel` → `get_novel` → `get_pool_balance`，然后对 fork 小说执行 Phase 2 流程

在 Epoch 2 完成后执行:

```
1. get_round_submissions(novelId:1, epoch:1, round:1) → 找一个被拒章节
2. [WRITER_B] fork_novel(
     originalNovelId: 1,
     branchChapterId: <rejected chapter>,
     title: "Fork of Alpha",
     roundMinSubmissions: 3, worldLineCount: 2, roundsPerEpoch: 2,
     ... (同Phase 0共同参数),
     initialPrizeEth: "0.5"
   )
3. get_novel(forkedNovelId) → 验证
4. get_pool_balance(forkedNovelId)
5. 对 fork 小说执行 1 个完整 epoch(Phase 2 流程)
```

---

## Phase 6: Complete & Query

> 使用 MCP tool: `complete_novel`, `update_novel_metadata`, `discover_novels`, `get_novel_stats`, `read_canon`, `get_my_chapters`, `get_chapter`, `get_chapter_context`

```
[CREATOR] complete_novel(novelId: 1)
[CREATOR] update_novel_metadata(novelId: 2, title: "Beta Revised")

discover_novels(sort:"hot", filter:"all")
discover_novels(sort:"pool", filter:"active")
discover_novels(filter:"completed")

get_novel_stats(novelId: 1..2 + fork)
read_canon(novelId: 1)
read_canon(novelId: 2)

[WRITER_A] get_my_chapters()
[WRITER_B] get_my_chapters()

get_chapter(chapterId: <某canon章节>)
get_chapter_context(chapterId: <某canon章节>)
```

---

## Phase 7: Final Report → `mcp/test-log.md`

输出收益汇总表:

| Role | Novel | Income Type | Amount (ETH) |
|------|-------|-------------|-------------|
| Creator | 1-2 | Royalty | ? |
| Writer A | 1-2 | Author Reward | ? |
| Writer B | 1-2 | Author Reward | ? |
| Voter A | 1-2 | Voting Reward | ? |
| Voter B | 1-2 | Voting Reward | ? |
| Keeper | 1-2 | Keeper Reward | ? |

全局汇总:
- 每个角色: 总收入 / 总支出 / 净收益
- 每个小说: 初始奖池 / tip / 最终奖池
- Fork 小说的独立统计

---

## 操作量估算

| 操作 | 每小说每epoch | ×3 epoch | ×2 novel | 总计 |
|------|-------------|---------|---------|------|
| submit_chapter | 3×2 rounds = 6 | 18 | 36 | ~36 |
| keeper_advance | 3×2 rounds + 2 epoch = 8 | 24 | 48 | ~48 |
| voter_cast_vote | (2+1)×2 = 6 | 18 | 36 | ~36 |
| voter_reveal | (2+1)×2 = 6 | 18 | 36 | ~36 |
| claim | ~6 | 18 | 36 | ~36 |
| switch_wallet | ~10 | 30 | 60 | ~60 |
| **Total** | | | | **~252** |

加上 tip/fork(1 epoch)/rules/query ≈ **~350 MCP tool calls**

---

## 已知问题与注意事项

1. **Salt store bug (已修复):** `voter.ts` 的 saltKey 需包含钱包地址，否则多 voter 互相覆盖。修复已提交，需重启 MCP server 生效。
2. **Chapter ID 是全局的:** 投票前必须 `get_round_submissions` 获取实际 chapterId，不能假设。
3. **Duration=1s:** keeper 调用前可能需等待 1s。如果返回"时间未到"，重试或 timewarp。
4. **Canon author 资格:** epoch settle 后 canon 链上的 writer 才能投 rule proposal。确保两个 writer 的章节都有机会入选。
5. **MCP 重启:** 如果修改了 MCP 代码需要重启，退出并提醒用户。重启后 salt store 清空，需在 Submitting 阶段重启。
