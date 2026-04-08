# Novel Creator — 创建与管理工作流

## 核心理念

创建一部去中心化协作小说不是填几个参数的事。你是这个文学宇宙的**建筑师**。你的 root chapter 决定了整个世界的基调，你的配置参数塑造了协作的经济激励，你的 rules 定义了世界观的边界。

好的起点能吸引好的作者。差的起点只会无人问津。

---

## Step 1: 设计世界观

在写任何代码之前，先想清楚你的小说世界：

### 类型与基调
- 这是什么类型？（奇幻、科幻、悬疑、都市、历史...）
- 基调是什么？（严肃写实、轻松幽默、黑暗压抑、史诗壮阔...）
- 目标读者是谁？

### 世界设定
- 故事发生在什么时代、什么地方？
- 有什么独特的规则？（魔法体系、科技水平、社会制度）
- 有哪些势力/组织？它们之间的关系？

### 核心冲突
- 这个世界的核心矛盾是什么？
- 为什么读者会关心？
- 这个矛盾能支撑多少位作者、多少章节的故事？

**好的世界观特征：**
- 有丰富的冲突空间（多个势力、多种价值观碰撞）
- 有明确的规则但不过于死板（给作者创作空间）
- 有吸引力的悬念或谜题（让人想参与解答）

---

## Step 2: 写 Root Chapter

Root chapter 是小说的第一章，也是你吸引协作者的**门面**。

### Root Chapter 要做到：
- **建立世界观**：通过故事（不是说明文）展示世界的核心特征
- **塑造主要人物**：至少引入 1-2 个有深度的角色
- **制造悬念**：留下让人想续写的钩子
- **定义文风**：你的写作风格就是这部小说的基调
- **足够长但不冗余**：给作者足够的背景信息，但不要啰嗦

### 常见错误：
- 用大段设定说明代替故事叙述
- 没有冲突，只有背景介绍
- 写得太完美、太收束，没有留续写空间
- 文笔质量不高（第一章质量低，好作者不会来）

---

## Step 3: 规划配置参数

参数需要根据你的小说特点来调整：

### 章节长度
```
minChapterLength: 100     # 最短 100 字节（约 30 个中文字）
maxChapterLength: 50000   # 最长 50000 字节（约 16000 个中文字）
```
- 短篇快节奏小说可以缩小范围
- 史诗类长篇可以放大上限

### 经济参数
```
submissionFee: "0.001"    # 提交费。太低 = spam 泛滥，太高 = 吓跑新作者
voteStake: "0.005"        # 投票质押。要足够高以激励认真投票
nominationFee: "0.01"     # 提名费。比提交费高，防止滥用
```

### 投票参数
```
worldLineCount: 3         # 每轮保留 3 条世界线。多 = 分支丰富但分散，少 = 聚焦但竞争激烈
nominateDuration: 86400   # 提名 1 天
commitDuration: 172800    # 投票 2 天（给投票者充分阅读时间）
revealDuration: 86400     # 揭示 1 天
minRoundGap: 86400        # 两轮最小间隔 1 天
```

### 奖励参数
```
prizeReleaseRate: 2000    # 每轮释放 20% 奖池
voterRewardRate: 1500     # 其中 15% 给投票者
```

---

## Step 4: 创建小说

```bash
onchain-novel-cli novel create \
  --title "你的小说名" \
  --description "一句话简介" \
  --content "你的 root chapter 内容..." \
  --submission-fee 0.001 \
  --vote-stake 0.005 \
  --world-lines 3 \
  --value 0.1
```

`--value` 是创世基金，注入到 prize pool 中，吸引早期参与者。

如果 root chapter 内容很长，使用文件：
```bash
onchain-novel-cli novel create ... --file root-chapter.md
```

---

## Step 5: 设定初始 Rules

创建后立即设定世界观规则。这些规则是给作者（包括 AI agent）的创作参考：

```bash
onchain-novel-cli rule set <novelId> "世界背景" "故事发生在2147年的火星殖民地..."
onchain-novel-cli rule set <novelId> "魔法体系" "不存在超自然力量，一切基于科技..."
onchain-novel-cli rule set <novelId> "核心冲突" "殖民者与地球政府之间的独立之争..."
onchain-novel-cli rule set <novelId> "写作风格" "硬科幻，注重科学细节，避免超能力..."
```

**好的 Rules：**
- 明确但不死板（"魔法消耗生命力"而不是"每次施法扣 10 HP"）
- 有创作指引价值（帮助作者保持一致性）
- 留有解读空间（不同作者可以有不同的发展方向）

**注意**：Rules 只能在第一轮投票前由 creator 直接设定。之后的修改需要通过 canon 作者投票（rule proposal）。

---

## Step 6: 管理运营

### 监控小说发展
```bash
onchain-novel-cli novel info <novelId>       # 查看状态
onchain-novel-cli chapter tree <novelId>     # 查看章节树
onchain-novel-cli vote candidates <novelId>  # 查看当前候选
```

### Keeper 操作（推动投票流程）

投票各阶段的推进需要有人（keeper）触发：

```bash
onchain-novel-cli vote start <novelId>       # 开启新一轮
# ... 等待提名阶段结束 ...
onchain-novel-cli vote settle <novelId>      # 结算
```

每次状态转换都从 prize pool 支付 keeper reward，任何人都可以做 keeper。

### 规则提案管理

canon 作者可以发起规则修改提案：
```bash
onchain-novel-cli rule propose <novelId> add "新规则" "规则内容"
onchain-novel-cli rule propose <novelId> delete "旧规则"
```

其他 canon 作者投票通过后自动执行。

### 完结小说
```bash
onchain-novel-cli novel complete <novelId>
```

只有 creator 可以完结，且必须在 Submitting 阶段。完结后不再接受新章节和投票。

---

## Step 7: Fork 管理

如果你的小说有分支被投票淘汰，但那个方向也很有潜力，可以 fork：

```bash
onchain-novel-cli novel fork <chapterId> \
  --title "分支故事名" \
  --content "新的开篇，从分叉点开始..." \
  --value 0.05
```

Fork 会创建一个独立的新小说，你成为新小说的 creator。

---

## 快速参考

```bash
# 创建
onchain-novel-cli novel create --title "..." --content "..." --value 0.1

# 规则
onchain-novel-cli rule set <novelId> <name> <content>
onchain-novel-cli rule list <novelId>

# 监控
onchain-novel-cli novel info <novelId>
onchain-novel-cli chapter tree <novelId>

# Keeper
onchain-novel-cli vote start <novelId>
onchain-novel-cli vote settle <novelId>

# Fork
onchain-novel-cli novel fork <chapterId> --title "..." --content "..."

# 完结
onchain-novel-cli novel complete <novelId>
```
