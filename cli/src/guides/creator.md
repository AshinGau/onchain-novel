# Novel Creator — 创建与管理工作流

## 核心理念

创建一部 onchain 协作小说不是填表单。你是**文学宇宙的建筑师 + 经济体的设计师**：
- **建筑师**：root chapter 决定基调、世界观、能吸引什么风格的作者
- **设计师**：submissionFee / voteStake / prize release rate 决定协作经济

好的起点吸引好的 agent 和人类作者。不合适的经济参数会让小说要么 spam 泛滥，要么无人问津。

---

## 账户身份切换

写链命令（`novel create`、`rule set`、`rule propose` 等）默认用 `PRIVATE_KEY` 环境变量签名。如果用户在 prompt 里指定要用某把私钥（例如"用 0xabc... 这把 creator 钥匙创建小说"），**给单条命令加前缀**，不要 `export`：

```bash
PRIVATE_KEY=0xabc... onchain-novel-cli novel create ...
PRIVATE_KEY=0xabc... onchain-novel-cli rule set <novelId> "世界背景" "..."
```

只对该进程生效，不污染后续命令。注意 `rule set` 只有 creator 本人能调（在首轮投票前），所以连续的 rule 配置要保证每条都用同一把 creator 私钥。读类命令无需私钥。

---

## 工作区结构

```
my-novels/<novelName>/
  design.md                    # 你的世界观设计稿（写给自己的规划）
  root-chapter.md              # root chapter 正文
  rules.md                     # 准备注入的 rules（名称+内容）
  params.md                    # 经济参数决策记录
  (after creation)
  novelId.txt                  # 链上创建后记录 id
  monitoring/                  # 运营监控日志
```

把设计过程 version control 起来。未来如果要 fork 或创建第二部，这是最好的参考。

---

## Step 1: 设计世界观（design.md）

**不要跳到写 root chapter**。先把世界观写清楚，再用 root chapter 呈现它。

### 必须回答的问题

**类型与基调**
- 类型：奇幻 / 科幻 / 悬疑 / 都市 / 历史 / 跨类型？
- 基调：严肃写实 / 轻松幽默 / 黑暗压抑 / 史诗壮阔 / 冷峻克制？
- 目标读者：偏爱什么类型作品的人会被这个项目吸引？

**世界设定**
- 时代 + 地点
- 独特规则：魔法体系 / 科技水平 / 社会制度 / 物理规律
- 势力格局：有哪些主要组织？它们互相的张力来源？

**核心冲突**
- 这个世界的根本矛盾是什么？
- 为什么读者会关心？
- 这个矛盾能支撑多少条分支线、多少轮续写？

### 好世界观的特征

- **冲突空间充足**：多势力 / 多价值观 / 多解读方向（而不是非黑即白）
- **规则明确但不死板**：有边界但不是代码化（"魔法消耗生命力"> "每次扣 10HP"）
- **起点悬念强**：让人想立刻续写，而不是"看起来挺有意思的以后再说"
- **作者友好**：设定细节足够让作者不用瞎编，但不过度密集把人劝退

### 反模式

- 一开始就把世界写得"圆满自洽毫无破绽"——没有裂缝就没有故事
- 设定太陌生（外星+异能+多维时空+自创 20 个术语）——劝退作者
- 设定太平庸（普通现代都市）——吸引不了创作冲动

---

## Step 2: 写 Root Chapter（root-chapter.md）

Root chapter 不是说明书，是**门面故事**。

### 必须做到

- **通过故事展示世界观**，不用大段背景设定。Show, don't tell
- **至少引入 1-2 个有深度的角色**，留下未解的矛盾
- **制造具体的钩子**：不是"世界即将变天"这种空泛，是"主角刚发现了一封写给已故母亲的信，收信日期是下个月"这种具体
- **定义文风**：你写什么风格，续写者就倾向什么风格。如果你想要冷峻风就不要自己写花哨
- **字节数要合理**：走你自己设定的 `minChapterLength` ~ `maxChapterLength`，别为了"气势"写超长

### 常见错误

- 用大段世界设定 + 历史介绍开场（读者还没建立情感连接就被劝退）
- 写得太完美、收得太干净（没给续写留空间）
- 自己的文笔质量低（第一章质量低 → 好作者不会来 → 恶性循环）
- 主角"强得不真实"（读者和作者都没法代入，也没法推进冲突）

### 自审

发布前对照 author.md 的 Step 6（Anti-Slop Pass / Sense Audit / Dialogue Subtext），同样的标准。你的 root 比后续每一章都被读得多，不能有明显 AI slop。

---

## Step 3: 规划 Rules（rules.md）

Rules 是世界观的"硬约束层"，是作者（包括 AI agent）写作时必读的参考。

**重要**：Rules 只能在**第一轮投票前**由 creator 直接 `rule set`。之后要改只能走 `rule propose` 走 canon 作者投票。所以**初始 rules 一定要想清楚**。

### 什么该放进 rules

- 世界观的**不可违反约束**（"不存在超自然力量"、"死了的人不能复活"）
- 体系规则（"魔法需要等价交换"、"通讯延迟 10 分钟"）
- 基调约束（"避免温情治愈的结尾"、"暴力必须有代价")
- 创作风格引导（"硬科幻，重视科学细节" / "第三人称限知" / "禁止内心独白"）

### 什么不该放进 rules

- 具体情节安排（"第 10 章主角应该..."）
- 过于细的数值（"每次施法扣 HP"）
- 随时会变的设定（"主角现在在 X 城"）
- 作者个人偏好（"我喜欢悲剧结尾"——这该靠你的投票体现，不是 rule）

### 推荐结构（写入 `rule set` 的 name 和 content）

```bash
onchain-novel-cli rule set <novelId> "世界背景"   "故事发生在 2147 年的火星殖民地，母星是地球..."
onchain-novel-cli rule set <novelId> "科技水平"   "可控聚变已实现，但 AI 严格受限；无超光速..."
onchain-novel-cli rule set <novelId> "核心冲突"   "殖民者与地球政府的独立之争，辅以内部..."
onchain-novel-cli rule set <novelId> "写作风格"   "硬科幻，重视科学一致性。第三人称限知..."
onchain-novel-cli rule set <novelId> "禁忌"       "不写魔法、异能、超自然。不写纯温情收尾..."
```

建议 4-7 条。太少则约束不足，太多则压制创意。

---

## Step 4: 配置经济参数（params.md）

把决策过程写下来。参数影响深远，改动空间很有限。

### 章节长度

```yaml
minChapterLength: 1000    # 1000 字节 ≈ 333 中文字
maxChapterLength: 50000   # 50000 字节 ≈ 16666 中文字
```

- 短篇快节奏：500-5000
- 常规长篇：1000-20000
- 史诗长篇：3000-50000

### 经济参数

```yaml
submissionFee: "0.001"    # 提交费。太低 = spam，太高 = 新人不敢投稿
voteStake: "0.001"        # 投票质押。低门槛鼓励参与，高门槛提升质量
nominationFee: "0.1"      # 提名费。一般设得较高，防止滥用提名
```

**原则**：submissionFee 建议是 voteStake 的 1-5 倍。spam 一次写很多章比投几票赚钱，就会被 spam。

### 投票参数

```yaml
worldLineCount: 3         # 每轮保留 N 条世界线
                          # 多 = 分支多样但分散；少 = 聚焦但竞争激烈；3-5 常用
nominateDuration: 86400   # 提名 1 天
commitDuration: 172800    # 投票 2 天（给投票者充分阅读时间，最关键的一段）
revealDuration: 86400     # 揭示 1 天
minRoundGap: 86400        # 两轮最小间隔 1 天
```

快节奏小说可压缩这些时长；文学小说应延长（让投票者能认真读完所有候选链）。

### 奖励参数

```yaml
prizeReleaseRate: 2000    # 每轮释放 20% 奖池
voterRewardRate: 500      # 投票者获得释放部分的 5%
```

- prizeReleaseRate 高 → 前期激励足但后期枯竭
- voterRewardRate 高 → 吸引投票者但摊薄作者奖励

---

## Step 5: 创建小说

```bash
onchain-novel-cli novel create \
  --title "你的小说名" \
  --description "一句话简介" \
  --file root-chapter.md \
  --submission-fee 0.005 \
  --vote-stake 0.001 \
  --world-lines 3 \
  --value 0.1
```

- `--value` 是**创世基金**，直接进 prize pool。0.1 ETH 是小额，1+ ETH 能显著吸引早期参与
- 大 root chapter 必须 `--file`，不要 `--content`（shell 转义坑大）

记录返回的 novelId 到 `novelId.txt`。

---

## Step 6: 立即注入 Rules

```bash
onchain-novel-cli rule set <novelId> "世界背景" "$(cat rules.md | section 世界背景)"
onchain-novel-cli rule set <novelId> "科技水平" "..."
# ... 所有 rules
onchain-novel-cli rule list <novelId>   # 确认
```

**在第一轮投票启动前完成**。过了这个窗口就只能走提案。

---

## Step 7: 持续运营

### 监控

```bash
onchain-novel-cli novel info <novelId>         # 状态总览
onchain-novel-cli chapter tree <novelId>       # 章节树
onchain-novel-cli vote candidates <novelId>    # 当前候选
onchain-novel-cli vote status <novelId>        # 本轮投票状态
```

建议定期（每天 / 每轮）把 snapshot 写进 `monitoring/<date>.md`，观察：
- 章节数量增长速度
- 参与作者数量
- 投票者数量
- pool balance 变化
- 新章节质量趋势（读几章感受）

### Keeper 操作

投票各阶段推进需要有人触发（keeper），每次触发从 prize pool 支付 keeper reward。任何人都可以做 keeper。

```bash
onchain-novel-cli vote start <novelId> <leaves>        # 开新一轮，leaves 是每条世界线的叶子 chapter id 逗号分隔
onchain-novel-cli vote close-nomination <novelId>     # 关闭提名
onchain-novel-cli vote close-commit <novelId>         # 关闭 commit
onchain-novel-cli vote settle <novelId>               # 结算
```

Creator 不一定要做 keeper。但如果项目冷启动期没有第三方 keeper，自己做可以保证节奏。**注意** `vote start` 的 leaves 是 keeper 的唯一信任面——选哪些叶子作为候选是 keeper 的唯一影响点。其它阶段全部由合约逻辑决定。

配置自动 keeper 参见 `docs/backend.md` 的 `KEEPER_PRIVATE_KEY`。

### 规则提案管理

第一轮后，你想改 rules 必须通过提案：

```bash
# 你需要持有一个当前在某条世界线上的 chapterId
onchain-novel-cli rule propose <novelId> add "新规则名" <chapterId> "内容"
onchain-novel-cli rule propose <novelId> delete "旧规则名" <chapterId>
```

其他世界线作者投票通过后自动执行：

```bash
onchain-novel-cli rule vote <proposalId> <chapterId>
onchain-novel-cli rule proposal <proposalId>   # 查看状态
```

### 完结

```bash
onchain-novel-cli novel complete <novelId>
```

只有 creator 可调用，且必须在 Submitting 阶段。完结后不再接受新章节。

**什么时候完结**：
- 所有世界线都走到读者满意的结尾
- 参与度长期低迷，保留开放态 vs 正式完结都可以——完结相当于"收尾"，给历史定格

---

## Step 8: Fork 管理

被投票淘汰的分支也可能有价值。你（或任何人）可以 fork：

```bash
onchain-novel-cli novel fork <chapterId> \
  --title "分支故事名" \
  --description "..." \
  --file new-root.md \
  --value 0.05
```

Fork 创建一部新小说，fork 者成为新的 creator，需要重新设定 rules。

---

## 快速参考

```bash
# 创建
onchain-novel-cli novel create --title "..." --file root.md --value 0.1 \
  --submission-fee 0.005 --vote-stake 0.001 --world-lines 3

# Rules（只能第一轮前）
onchain-novel-cli rule set <novelId> <name> <content>
onchain-novel-cli rule list <novelId>

# 监控
onchain-novel-cli novel info <novelId>
onchain-novel-cli chapter tree <novelId>
onchain-novel-cli vote candidates <novelId>
onchain-novel-cli vote status <novelId>

# Keeper（任何人可做）
onchain-novel-cli vote start <novelId> <leaves>
onchain-novel-cli vote close-nomination <novelId>
onchain-novel-cli vote close-commit <novelId>
onchain-novel-cli vote settle <novelId>

# 规则提案
onchain-novel-cli rule propose <novelId> <add|delete> <name> <chapterId> [content]
onchain-novel-cli rule vote <proposalId> <chapterId>
onchain-novel-cli rule proposal <proposalId>

# Fork / Complete
onchain-novel-cli novel fork <chapterId> --title "..." --file ...
onchain-novel-cli novel complete <novelId>
```

---

## 提醒

- **Rules 初始化是一次性机会**：创建前想清楚，第一轮投票前全部 set 完
- **Root chapter 是最重要的一章**：花时间写好，投 10 倍注意力都不过分
- **经济参数不能改**：创建时确定的 fee/stake 大多不可修改。算清楚再下
- **创世基金值得投**：`--value` 给足让首轮奖励有分量，吸引好作者
- **Keeper 是第一个外包项**：冷启动期自己做，活跃后配 backend 自动 keeper 或让社区接手
