# MCP Server Lifecycle Test Plan (Multi-User, Compact)

> 4 novels × 4 epochs, 4 chapters/round, 7 roles.
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

## Phase 0: Create 4 Novels [CREATOR]

| # | title | bootstrap | initialPrizeEth | roundsPerEpoch | worldLineCount | roundMinSubmissions | stakeAmount | prizeReleaseRate | voterRewardRate |
|---|-------|-----------|-----------------|----------------|----------------|---------------------|-------------|------------------|-----------------|
| 1 | "Alpha" | ["Genesis: silence."] | "1.0" | 2 | 2 | 4 | "0.01" | 3000 | 1000 |
| 2 | "Beta" | ["Genesis: glass city."] | "2.0" | 2 | 2 | 4 | "0.02" | 2500 | 1500 |
| 3 | "Gamma" | ["Genesis: machine wakes."] | "0.5" | 2 | 2 | 4 | "0.01" | 4000 | 500 |
| 4 | "Delta" | ["Genesis: fire rains."] | "3.0" | 2 | 2 | 4 | "0.01" | 2000 | 2000 |

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

| Novel | rules |
|-------|-------|
| 1 | [{name:"setting", content:"Silent world"}, {name:"tone", content:"Mysterious"}] |
| 2 | [{name:"setting", content:"Glass city"}, {name:"protagonist", content:"Architect"}] |
| 3 | [{name:"setting", content:"Machine realm"}, {name:"genre", content:"Sci-fi"}] |
| 4 | [{name:"setting", content:"Apocalypse"}, {name:"tone", content:"Dramatic"}] |

**验证:** `get_rules` for each

---

## Phase 2: Epoch Loop (×4 epochs per novel)

### 每个 Round 的标准操作 (roundsPerEpoch=2)

```
1. get_active_world_lines(novelId) → 拿到 parentChapterId

2. [WRITER_A] submit_chapter × 2
     content: "n{N}_e{E}_r{R}_wA_{i}"
   [WRITER_B] submit_chapter × 2
     content: "n{N}_e{E}_r{R}_wB_{i}"

3. [KEEPER] keeper_check_and_advance  → close_submissions

4. get_round_submissions(novelId, epoch, round) → 拿到实际 chapterId 列表
   选择: Voter A → Writer A 的第1章, Voter B → Writer B 的第1章

5. [VOTER_A] voter_cast_vote(candidateId=WA_ch1, stakeEth="0.05")
   [VOTER_B] voter_cast_vote(candidateId=WB_ch1, stakeEth="0.03")

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

- **Epoch 1-2:** Voter A/B 投不同章节(分歧) → 测试准确/不准确差异
- **Epoch 3-4:** Voter A/B 投同一章节(共识) → 测试一致投票

---

## Phase 3: Tip [TIPPER + others]

在 Epoch 2 完成后执行:

```
[TIPPER]   tip_novel(1, "0.5")
[TIPPER]   tip_novel(2, "1.0")
[VOTER_A]  tip_novel(3, "0.3")
[WRITER_A] tip_novel(4, "0.2")
```

每次 tip 后 `get_pool_balance` 验证。

---

## Phase 4: Rules Change [WRITER_A + WRITER_B]

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

在 Epoch 2 完成后执行:

```
1. get_round_submissions(novelId:1, epoch:1, round:1) → 找一个被拒章节
2. [WRITER_B] fork_novel(
     originalNovelId: 1,
     branchChapterId: <rejected chapter>,
     title: "Fork of Alpha",
     roundMinSubmissions: 4, worldLineCount: 2, roundsPerEpoch: 2,
     ... (同Phase 0共同参数),
     initialPrizeEth: "0.5"
   )
3. get_novel(forkedNovelId) → 验证
4. get_pool_balance(forkedNovelId)
5. 对 fork 小说执行 1 个完整 epoch(Phase 2 流程)
```

---

## Phase 6: Complete & Query

```
[CREATOR] complete_novel(novelId: 1)
[CREATOR] complete_novel(novelId: 2)
[CREATOR] update_novel_metadata(novelId: 3, title: "Gamma Revised")

discover_novels(sort:"hot", filter:"all")
discover_novels(sort:"pool", filter:"active")
discover_novels(filter:"completed")

get_novel_stats(novelId: 1..4 + fork)
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
| Creator | 1-4 | Royalty | ? |
| Writer A | 1-4 | Author Reward | ? |
| Writer B | 1-4 | Author Reward | ? |
| Voter A | 1-4 | Voting Reward | ? |
| Voter B | 1-4 | Voting Reward | ? |
| Keeper | 1-4 | Keeper Reward | ? |

全局汇总:
- 每个角色: 总收入 / 总支出 / 净收益
- 每个小说: 初始奖池 / tip / 最终奖池
- Fork 小说的独立统计

---

## 操作量估算

| 操作 | 每小说每epoch | ×4 epoch | ×4 novel | 总计 |
|------|-------------|---------|---------|------|
| submit_chapter | 4×2 rounds | 32 | 128 | ~128 |
| keeper_advance | 2×2+2 | 24 | 96 | ~96 |
| voter_cast_vote | (2+1)×2 | 24 | 96 | ~96 |
| voter_reveal | (2+1)×2 | 24 | 96 | ~96 |
| claim | ~6 | 24 | 96 | ~96 |
| switch_wallet | ~12 | 48 | 192 | ~192 |
| **Total** | | | | **~800** |

加上 tip/fork/rules/query ≈ **~900 MCP calls**

---

## 已知问题与注意事项

1. **Salt store bug (已修复):** `voter.ts` 的 saltKey 需包含钱包地址，否则多 voter 互相覆盖。修复已提交，需重启 MCP server 生效。
2. **Chapter ID 是全局的:** 投票前必须 `get_round_submissions` 获取实际 chapterId，不能假设。
3. **Duration=1s:** keeper 调用前可能需等待 1s。如果返回"时间未到"，重试或 timewarp。
4. **Canon author 资格:** epoch settle 后 canon 链上的 writer 才能投 rule proposal。确保两个 writer 的章节都有机会入选。
5. **MCP 重启:** 如果修改了 MCP 代码需要重启，退出并提醒用户。重启后 salt store 清空，需在 Submitting 阶段重启。
