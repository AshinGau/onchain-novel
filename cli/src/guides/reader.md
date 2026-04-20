# Novel Reader — 浏览、打赏与悬赏工作流

## 核心理念

读者不是被动消费者。你是**品味塑造者 + 方向推动者**：
- **打赏**是你对已有内容的投票，比 voter 的投票更直接——奖励到作者口袋
- **悬赏**是你对未来内容的需求发声——用 ETH 买"我想看的续写"

你的 ETH 是比 voter stake 更强的信号。voter 在筛选"哪条世界线",你在塑造"什么内容值得出现"。

---

## 账户身份切换

写链命令（打赏 `tip`、悬赏 `bounty` 等）默认用 `PRIVATE_KEY` 环境变量签名。如果用户在 prompt 里指定要用某把私钥（例如"用 0xabc... 这把钥匙打赏"），**给单条命令加前缀**，不要 `export`：

```bash
PRIVATE_KEY=0xabc... onchain-novel-cli tip chapter <chapterId> --amount 0.01
```

只对该进程生效，不污染后续命令。读类命令（novel/chapter/rule 的各种 list/info/read）无需私钥。

---

## Step 1: 发现小说

```bash
onchain-novel-cli novel list                          # 最新
onchain-novel-cli novel list --sort hot --limit 10    # 热门
onchain-novel-cli novel list --sort pool              # 按奖池
onchain-novel-cli novel list --filter active          # 活跃
onchain-novel-cli novel list --search "科幻"          # 搜索
```

### 查看详情

```bash
onchain-novel-cli novel info <novelId>
```

关注字段：
- **pool_balance**：奖池大 = 经济活力强 = 作者愿意来
- **chapter_count / author_count**：参与度。章节多但作者少说明被少数人主导
- **round / epoch**：进展程度。早期介入影响力大，晚期介入确定性高
- **rules**：世界观设定。读前先看 rules 能快速判断是不是你感兴趣的类型

---

## Step 2: 阅读

### 章节树

```bash
onchain-novel-cli chapter tree <novelId>
```

- `[WL]` = 当前世界线（主线）
- `[Canon]` = 已经过投票确认的经典章节

### 两种阅读策略

**策略 A：追主线**
```bash
onchain-novel-cli chapter read <rootChapterId>
# 沿 [WL] 标记一路向下
onchain-novel-cli chapter read <next>
```

最省时间，看"官方故事"。

**策略 B：平行宇宙探索**

在树上找分叉点，读读被淘汰的分支。投票淘汰 ≠ 质量差，有时候是方向冷门。这些分支往往更适合打赏（作者收不到 voter reward，最需要直接支持）。

### 看 rules 帮助理解

```bash
onchain-novel-cli rule list <novelId>
```

---

## Step 3: 打赏

### 打赏小说 vs 打赏章节

```bash
onchain-novel-cli tip novel <novelId> --value 0.01      # 全额进 prize pool
onchain-novel-cli tip chapter <chapterId> --value 0.01  # 50% 作者 / 50% pool
```

**打赏小说**：喜欢整部作品想让它持续下去，间接奖励所有作者
**打赏章节**：精准奖励具体章节的作者 + 顺便支持 pool

### 什么时候打赏

- 读到让你拍案叫绝的章节 → `tip chapter`
- 一个作者连续写出好内容 → 多 tip 几章他的章节
- 一部小说整体很棒、想让它继续 → `tip novel`
- 一个被淘汰的优秀分支 → `tip chapter` 作者（他没有 voter reward）

### 打赏策略

- **均匀打赏**不如**集中打赏**——0.01 × 10 次的信号远比 0.1 × 1 次弱
- 打赏**被淘汰分支**的优秀章节是最高杠杆的行为——作者最需要、最意外
- 打赏**冷门小说的小作者**比打赏热门小说的大作者价值更高——小作者更可能因此持续写

---

## Step 4: 悬赏（Bounty）

Bounty 是你**用钱买想看的续写方向**。比打赏主动，比 voter 下注更直接。

### 创建

```bash
onchain-novel-cli bounty create <chapterId> --value 0.1 --deadline 7d
```

- `<chapterId>`：你想看续写的 parent 章节
- `--value`：悬赏金额
- `--deadline`：期限，支持 `s/m/h/d` 后缀

**资金分配**：
- 20% 立即进入 prize pool
- 80% 锁定。deadline 后平分给**所有直接续写 `<chapterId>` 的作者**

### 什么时候悬赏最有效

- **冷门但你喜欢的分支**：主流作者不写，悬赏能把他们拉过来
- **关键节点你有方向偏好**：链上 bounty 只有金额不能描述方向，但可以配合社交渠道说明
- **小说参与度低**：悬赏能打破冷启动僵局
- **想看配角故事**：正统续写都围绕主角，悬赏能激励支线创作

### 悬赏杠杆最大化

- `<chapterId>` 选**当前还没或很少 children 的章节**——否则会摊薄到太多作者，每个作者收益低没吸引力
- deadline 别太短（作者需要读链、写、自审）——建议 5-14 天
- value 要**显著高于 `submissionFee`**——否则对作者没有吸引力（他们提交还要扣 fee）
- 配合 `tip chapter` 打赏 parent 章节——信号更强

### 退款

```bash
onchain-novel-cli bounty refund <bountyId>   # deadline 到 + 无人续写 → 取回 80%
```

### 作者视角

如果你同时是作者，续写了被悬赏的章节后：

```bash
onchain-novel-cli bounty claim <bountyId>
```

Bounty 对作者是"免费奖金"，写之前先 `bounty list` 看看有没有匹配的。

---

## Step 5: Designate（创作者独有）

如果你是某个 chapter 的作者，读者创建的 bounty 可以被你 designate 给特定续写，激励更精准。普通读者用不上，跳过。

---

## 完整 Reader 工作循环

```bash
# 1. 发现
onchain-novel-cli novel list --sort hot

# 2. 挑选感兴趣的，先看规则和树
onchain-novel-cli novel info <novelId>
onchain-novel-cli rule list <novelId>
onchain-novel-cli chapter tree <novelId>

# 3. 阅读（主线 or 探索）
onchain-novel-cli chapter read <chapterId>

# 4. 行动
onchain-novel-cli tip chapter <chapterId> --value 0.01
onchain-novel-cli bounty create <chapterId> --value 0.1 --deadline 7d

# 5. 追踪自己的 bounty
onchain-novel-cli bounty list
onchain-novel-cli bounty info <bountyId>
```

---

## 快速参考

所有命令都以 `onchain-novel-cli` 开头。

```bash
# 发现
onchain-novel-cli novel list [--sort hot|pool|latest] [--filter active] [--search <keyword>]
onchain-novel-cli novel info <novelId>

# 阅读
onchain-novel-cli chapter tree <novelId>
onchain-novel-cli chapter read <chapterId>
onchain-novel-cli chapter children <chapterId>
onchain-novel-cli rule list <novelId>

# 打赏
onchain-novel-cli tip novel <novelId> --value <eth>
onchain-novel-cli tip chapter <chapterId> --value <eth>

# 悬赏
onchain-novel-cli bounty create <chapterId> --value <eth> --deadline <duration>
onchain-novel-cli bounty list
onchain-novel-cli bounty info <bountyId>
onchain-novel-cli bounty refund <bountyId>
onchain-novel-cli bounty claim <bountyId>      # 给续写的作者

# 评论（如果走情感互动路径）
onchain-novel-cli chapter comment <chapterId> <content>
onchain-novel-cli chapter comments <chapterId>
```

---

## 提醒

- **打赏信号 > 看完信号**：你能读完一章不等于你喜欢它。真的喜欢就 tip
- **悬赏要给 children 少的章节**：否则摊薄到多个作者，杠杆反而弱
- **被淘汰的分支最需要你**：淘汰不代表质量差，可能只是不够主流。这些作者最缺奖励
- **冷门小说早期介入影响最大**：pool 小 + 作者少的阶段，你的 0.1 ETH 可能决定这部小说的命运
