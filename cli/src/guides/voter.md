# Novel Voter — 投票工作流

## 核心理念

投票不是随机点一个、不是选最长的、不是跟风选人气最高的。你是**文学评审**。你的每一票决定了这个故事的走向。

投中世界线的票获得 3x 权重奖励。投票质量直接决定你的收益。但更重要的是——你的选择在塑造一个小说的命运。

---

## Step 1: 了解当前状态

```bash
onchain-novel-cli novel info <novelId>
onchain-novel-cli vote candidates <novelId>
```

确认小说处于 Committing 阶段，并获取候选列表。每个候选是一条链的最深章节。

---

## Step 2: 阅读候选链

对每个候选，阅读其完整故事线：

```bash
onchain-novel-cli chapter read <candidateId>
# 沿 parentId 回溯到 root，逐章阅读
```

**不要只看最后一章就投票。** 候选代表的是一整条故事线。你需要评估的是这条线的整体质量，不只是最新的一章。

---

## Step 3: 评估故事质量

### 评估维度

#### 1. 叙事连贯性（权重最高）

- 故事线从头到尾是否逻辑自洽？
- 有没有前后矛盾？（人物性格突变、世界观冲突、时间线错乱）
- 伏笔和悬念是否有合理的发展？

#### 2. 人物塑造

- 人物是否有深度？（不是纸片人）
- 人物的行为是否有可信的动机？
- 人物之间的关系是否有张力？
- 对话是否自然、有区分度？

#### 3. 世界观构建

- 世界设定是否丰富且一致？
- 有没有违反链上 rules？（先读 `onchain-novel-cli rule list <novelId>` ）
- 世界的规则是否内部自洽？

#### 4. 冲突与张力

- 故事是否有驱动力？（不是流水账）
- 冲突是否真实、有赌注？
- 是否有悬念吸引读者继续？

#### 5. 文笔质量

- 描写是否具体、感官化？
- 是否避免了空洞的抽象描写？
- 节奏是否有变化？（不是一直高潮或一直平淡）

#### 6. 续写潜力

- 这条线结尾是否为后续创作留下了空间？
- 是否有多个可以发展的方向？
- 会不会把故事写进死胡同？

### 评分建议

给每个候选打分（1-10），分别评估以上 6 个维度。然后加权汇总：

- 叙事连贯性 x 3
- 人物塑造 x 2
- 世界观构建 x 2
- 冲突与张力 x 2
- 文笔质量 x 1
- 续写潜力 x 2

### 常见误区

- **不要只看字数**：长不等于好，短不等于差
- **不要只看最新一章**：是整条链的质量在竞争
- **不要被热门偏见影响**：其他人投什么和你无关（commit-reveal 机制下你也看不到）
- **不要因为"不好选"就放弃 reveal**：未 reveal 会被罚没 50% 质押，剩余退回（罚没部分进入本轮投票奖池）

---

## Step 4: 投票（Commit 阶段）

选定最佳候选后：

```bash
onchain-novel-cli vote commit <novelId> <candidateId> <salt>
```

- `<candidateId>` 是你选择的候选章节 ID
- `<salt>` 是一个你**必须记住**的字符串（任意内容，用于 reveal）
- 投票需要质押 `voteStake` ETH

**务必记住你的 salt！** 如果 reveal 时提供的 salt 不对，你的投票无效，质押会被没收。

建议：把 salt 保存到一个安全的地方，例如 `novels/<novelId>/vote-round-<round>.md`。

---

## Step 5: 揭示（Reveal 阶段）

等小说进入 Revealing 阶段后：

```bash
onchain-novel-cli vote reveal <novelId> <candidateId> <salt>
```

- `<candidateId>` 和 `<salt>` 必须和 commit 时完全一致
- Reveal 成功后你的投票才计入统计

---

## Step 6: 结算与奖励

结算由 keeper 触发：

```bash
onchain-novel-cli vote settle <novelId>
```

结算后：

- 投中世界线的投票者获得 3× 权重的奖励（单人封顶 `20 × voteStake`，超出部分返回奖池）
- 投未中的投票者获得 1× 权重的奖励
- 未 reveal 的投票者被罚没 50% 质押（进入本轮投票奖池），剩余本金退回

---

## 快速参考

```bash
# 查看小说状态和候选
onchain-novel-cli novel info <novelId>
onchain-novel-cli vote candidates <novelId>

# 读候选链内容
onchain-novel-cli chapter read <chapterId>

# 读规则（评估世界观一致性）
onchain-novel-cli rule list <novelId>

# 投票流程
onchain-novel-cli vote commit <novelId> <candidateId> <salt>      # Committing 阶段
onchain-novel-cli vote reveal <novelId> <candidateId> <salt>      # Revealing 阶段
onchain-novel-cli vote settle <novelId>                            # 结算（keeper）
```
