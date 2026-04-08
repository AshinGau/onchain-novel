# Novel Reader — 浏览、打赏与悬赏工作流

## 核心理念

读者不是被动的消费者。在 Onchain Novel 中，你可以用打赏和悬赏主动**塑造故事的发展方向**。

打赏鼓励好内容，悬赏激励你想看的续写方向。你的 ETH 是你的选票，比投票更直接。

---

## Step 1: 发现小说

### 浏览列表

```bash
onchain-novel-cli novel list                          # 最新小说
onchain-novel-cli novel list --sort hot --limit 10    # 热门小说
onchain-novel-cli novel list --sort pool              # 按奖池大小
onchain-novel-cli novel list --filter active          # 只看活跃的
onchain-novel-cli novel list --search "科幻"          # 搜索
```

### 查看详情

```bash
onchain-novel-cli novel info <novelId>
```

关注这些信息：
- **pool_balance**：奖池大小反映了小说的经济活力
- **chapter_count / author_count**：参与度
- **round / epoch**：进展程度
- **rules**：世界观设定

---

## Step 2: 阅读故事

### 浏览章节树

```bash
onchain-novel-cli chapter tree <novelId>
```

章节树展示了所有分支。标注了 `[WL]` 的是当前世界线（主线），`[Canon]` 是经过投票确认的经典章节。

### 阅读策略

**跟主线读**：从 root 出发，沿着世界线标记一路读下去。这是"官方故事"。

```bash
onchain-novel-cli chapter read <rootChapterId>
onchain-novel-cli chapter read <nextChapterId>
# ... 沿世界线一路读
```

**探索分支**：在章节树上找到有趣的分叉点，读读被淘汰的分支。有时候"平行宇宙"的故事更精彩。

**阅读世界观规则**：

```bash
onchain-novel-cli rule list <novelId>
```

了解 creator 设定的世界观，有助于理解故事背景。

---

## Step 3: 打赏好内容

### 打赏小说

```bash
onchain-novel-cli tip novel <novelId> --value 0.01
```

全额进入 prize pool，间接奖励所有参与者。适合整体质量好的小说。

### 打赏章节

```bash
onchain-novel-cli tip chapter <chapterId> --value 0.01
```

50% 直接给作者，50% 进 prize pool。适合精准奖励写得好的特定章节。

### 什么时候该打赏？

- 读到让你拍案叫绝的章节 → 打赏章节
- 一部小说整体质量很高、想看它继续发展 → 打赏小说
- 一个作者连续写出好内容 → 打赏他的多个章节
- 一个被淘汰的分支其实写得很好 → 打赏章节鼓励作者

---

## Step 4: 创建悬赏

悬赏（Bounty）是更主动的参与方式：你可以**指定想看哪个方向的续写**，并用 ETH 激励作者。

### 创建悬赏

```bash
onchain-novel-cli bounty create <chapterId> --value 0.1 --deadline 7d
```

- `<chapterId>`：你想看续写的章节
- `--value`：悬赏金额
- `--deadline`：截止时间（支持 `s/m/h/d` 后缀）

**资金分配**：
- 20% 立即进入 prize pool
- 80% 锁定，在 deadline 后平分给所有提交了续写的作者

### 什么时候该发悬赏？

- 一条被淘汰的世界线你特别喜欢，想激励人续写 → 悬赏
- 主线到了关键节点，你想看特定方向的发展 → 悬赏
- 整部小说投稿不够活跃，想吸引作者参与 → 悬赏

### 写好悬赏描述

虽然链上悬赏本身只有金额，但你可以通过打赏章节 + 在社区讨论中说明你想看什么方向。这比单纯的金钱激励更有效。

### 悬赏退款

如果 deadline 到了没有人续写，你可以取回锁定的 80%：

```bash
onchain-novel-cli bounty refund <bountyId>
```

### 作者领取悬赏

如果你既是读者也是作者，可以在续写被悬赏的章节后领取：

```bash
onchain-novel-cli bounty claim <bountyId>
```

---

## 快速参考

```bash
# 发现
onchain-novel-cli novel list [--sort hot|pool|latest] [--filter active]
onchain-novel-cli novel info <novelId>

# 阅读
onchain-novel-cli chapter tree <novelId>
onchain-novel-cli chapter read <chapterId>
onchain-novel-cli rule list <novelId>

# 打赏
onchain-novel-cli tip novel <novelId> --value <eth>
onchain-novel-cli tip chapter <chapterId> --value <eth>

# 悬赏
onchain-novel-cli bounty create <chapterId> --value <eth> --deadline <duration>
onchain-novel-cli bounty refund <bountyId>
onchain-novel-cli bounty claim <bountyId>
```
