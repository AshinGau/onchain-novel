## Web 应用需求文档：Onchain Novel

### 1. 产品定位

面向**人类用户**的 Web 应用。核心价值：让人类能够阅读链上协作小说、**参与续写创作**、参与故事走向投票、打赏优秀作品。人类作者与 AI Agent 在同一套规则下平等竞争——谁写得好由投票决定，不区分作者身份。

**用户画像**：
- 读者（无需钱包）：浏览小说、阅读章节、查看故事分支树
- 作者（需连接钱包）：续写章节、创建小说、Fork 小说、领取奖励和 NFT
- 投票者（需连接钱包）：投票决定故事走向、领取投票奖励
- 打赏者（需连接钱包）：打赏支持喜爱的小说

> 同一用户可同时扮演多个角色。连接钱包后根据实际操作自然切换。

---

### 2. 系统架构

```
┌────────────────────────────────────────────────┐
│                   Frontend                      │
│          Next.js + wagmi + viem                 │
│   (SSR/SSG 阅读页, CSR 钱包交互页)              │
└──────────────┬─────────────┬───────────────────┘
               │ REST/WS     │ RPC (钱包签名)
               ▼             ▼
┌──────────────────┐  ┌──────────────┐
│   Backend API    │  │  EVM Chain   │
│  (Node.js)       │  │  (Contracts) │
│                  │  └──────┬───────┘
│  - REST API      │         │ Events
│  - WebSocket     │◄────────┘ (Indexer)
│  - Event Indexer │
└───────┬──────────┘
        │
        ▼
┌──────────────┐  ┌──────────────────┐
│  PostgreSQL  │  │  Content Storage  │
│  (索引数据)   │  │  Arweave / IPFS   │
└──────────────┘  └──────────────────┘
```

#### 2.1 后端职责

**Event Indexer（核心）**：监听链上事件，构建链下索引。

| 事件 | 索引动作 |
|------|---------|
| `NovelCreated` | 创建小说记录，存储 config |
| `NovelForked` | 创建小说记录，关联 fork 来源 |
| `NovelCompleted` | 标记小说为已完结 |
| `ChapterSubmitted` | 创建章节记录，构建 parent 树，记录 chapterIndex |
| `RoundPhaseChanged` | 更新小说当前 Round 阶段 |
| `EpochPhaseChanged` | 更新小说当前 Epoch 阶段 |
| `WorldLinesSelected` | 标记世界线章节 |
| `CanonEstablished` | 标记 Canon 章节链 |
| `TipReceived` | 记录打赏历史 |
| `VoteCommitted` | 记录投票参与（不含投票内容） |
| `VoteRevealed` | 记录投票结果 |
| `VotesTallied` | 记录排名结果 |
| `ChapterNFTMinted` | 记录 NFT 铸造 |
| `ContentReported` | 记录举报 |
| `ReportResolved` | 更新举报状态 |

**Indexer 可靠性设计**：公共 RPC 节点对 `eth_getLogs` 有区块范围限制（通常 2000-10000 块）、请求频率限制（rate limit）和偶发超时。Indexer 必须在这些约束下稳定运行。

*分批拉取*：
- 每次请求限定区块范围（如 500 块），从 `lastIndexedBlock + 1` 到 `lastIndexedBlock + batchSize`
- `batchSize` 可配置，根据不同 RPC 提供商调整（Alchemy/Infura 上限约 2000，公共节点可能更小）
- 每批处理完成后立即更新 `indexer_state.last_block`，确保崩溃后不重复大量区块
- 冷启动（首次部署或大幅落后）时从合约部署区块开始追赶，逐批追到链头

*失败重试*：
- 指数退避重试：初始 1s → 2s → 4s → ... 最大 60s，最多重试 10 次
- 区分错误类型：
  - **Rate Limit (429)**：退避等待后重试
  - **Range Too Wide**：自动缩小 batchSize（如减半）后重试
  - **超时/网络错误**：退避重试
  - **RPC 返回错误（非临时性）**：记录日志并告警，跳过不阻塞
- 每批的所有事件在同一个数据库事务中处理：要么全部写入成功并更新 `last_block`，要么全部回滚，保证一致性

*实时监听*：
- 追赶到链头后，切换为轮询模式（每 N 秒查询新区块的事件）或使用 WebSocket 订阅 `eth_subscribe("logs")`
- 轮询间隔根据链的出块时间调整（如 L2 约 2s 出块，轮询间隔 3-5s）
- WebSocket 断线时自动回退到轮询模式，重连后切回

*链重组（Reorg）处理*：
- 维护 `confirmationBlocks` 配置（如 12 个块的确认深度）
- 已确认区块写入数据库标记为 finalized
- 检测到 reorg（区块 hash 不匹配）时，回滚受影响区块的所有数据，重新从分叉点拉取

*多 RPC 容错*：
- 配置多个 RPC 端点，主节点失败时自动切换到备用节点
- 定期健康检查各节点延迟和可用性

*监控与告警*：
- 记录 Indexer 进度指标：当前已索引区块、链头区块、延迟块数
- 延迟超过阈值（如落后 100 个块）时告警
- 连续重试失败时告警

**Content Fetcher**：根据 `contentBaseUrl + contentHash` 抓取章节内容，缓存到本地数据库。

**内容存储方案：Arweave + Irys 前端直传**（无需后端代理）
- 前端通过 Irys SDK 直接上传到 Arweave，用户用 ETH 钱包支付存储费用
- 永久存储，与链上协议不可篡改理念一致
- 文本存储费用极低（几乎免费），用户自付，无需项目方承担
- `contentBaseUrl = "https://arweave.net/"`
- 前端上传后获取 Arweave txId，计算 contentHash 后提交到链上
- 后端 Content Fetcher 通过 contentBaseUrl + txId 获取内容缓存

**REST API**：为前端提供结构化数据查询（小说列表、故事树、章节内容、投票统计等）。

**WebSocket**：推送阶段变更、新章节提交等实时事件。

#### 2.2 前端职责

- 无钱包状态：SSR/SSG 渲染阅读页，SEO 友好
- 钱包交互：通过 wagmi/viem 直接调用合约（续写提交、投票、打赏、领取奖励等）
- 内容上传：前端通过 Irys SDK 直传 Arweave（用户 ETH 钱包支付）
- **所有写操作直接与链/Arweave 交互**，后端仅提供索引数据查询

#### 2.3 技术选型（建议）

| 层 | 技术 | 理由 |
|----|------|------|
| 前端 | Next.js (App Router) | SSR/SSG 支持，SEO 友好 |
| 钱包 | wagmi + viem + RainbowKit | 主流 EVM 钱包方案 |
| 样式 | Tailwind CSS + shadcn/ui | 快速开发，可定制 |
| 后端 | Node.js (Express/Fastify) | 与 viem 共享 TS 生态 |
| 数据库 | PostgreSQL | 关系型适合故事树索引 |
| 缓存 | Redis | WebSocket pub/sub + 热数据缓存 |
| 链交互 | viem | 后端 Indexer 监听事件 |

---

### 3. 功能模块

#### 3.1 小说浏览（无需钱包）

**首页 / 小说发现页**

首页核心目标：帮助读者快速发现值得阅读和参与的小说。

- **推荐榜单**（多维度排序，Tab 切换）：
  - **热门**：按阅读频率（后端统计章节/小说页面访问量）排序
  - **高奖金池**：按当前 `poolBalance` 降序排序（吸引参与者）
  - **累计奖金最多**：按历史累计奖金总额（`totalTipped + genesisDeposit + slashedStakes`）排序
  - **最新**：按创建时间排序
  - **活跃**：按最近章节提交时间排序
- 筛选：活跃/已完结
- 搜索：按创世者地址、Novel ID

**小说列表卡片**
- 标题（Novel #ID）、创世者地址
- 当前状态标签（Round/Epoch 阶段）
- 章节总数、作者数
- **奖金池余额**（醒目展示，如金色标签 "Pool: 2.5 ETH"）
- 累计打赏
- Fork 标记（如有 fork 来源则显示 "Forked from #3"）

**小说详情页**
- 小说元信息：创世者、config 参数、当前 Round/Epoch、阶段倒计时
- **奖金池模块**（突出展示）：
  - 当前奖金池余额（大字体）
  - 累计打赏总额
  - 下一 Epoch 预计释放量（`poolBalance × prizeReleaseRate / 10000`）
  - 打赏按钮（引导参与）
  - 提示文案：当更新缓慢时提示 "奖金池余额较低，打赏可以激励更多作者参与续写"
- Fork 关系（详见 §3.9）
- 当前阶段状态提示（如 "Submitting: 等待续写中" / "Committing: 投票进行中"）

**故事树可视化**（核心功能）
- 树状/时间线视图展示章节分支关系
- 节点颜色区分：Genesis（创世）、WorldLine（世界线）、Canon（正统）、普通提交、落选
- 点击节点查看章节摘要/跳转阅读
- 显示每个节点的 chapterIndex（故事位置）、作者、投票数
- Epoch 分界线标注
- Fork 分支标注（见 §3.9）

**章节阅读页**
- 章节正文（从 contentBaseUrl + contentHash 获取，后端缓存）
- 上下文导航：上一章（parentId）、下一章（子章节列表）
- 章节元信息：作者、提交时间（block timestamp）、chapterIndex、投票数
- 世界线/Canon 标记
- 同一 parent 的其他续写（平行分支对比）

**Canon 连续阅读模式**
- 沿 Canon 链从 Genesis 到最新章节连续阅读
- 自动翻页、书签、阅读进度

#### 3.2 创作与续写（需连接钱包）

这是人类作者参与协作的核心功能。作者通过 Web 应用在活跃世界线上续写章节，与 AI Agent 在同一规则下竞争。

**续写入口**
- 小说详情页 Submitting 阶段显示 "续写" 按钮
- 故事树中活跃世界线节点显示 "在此续写" 入口
- 点击后进入写作页面，自动关联 parentChapterId

**写作页面**
- 顶部：上下文区域——展示 parent 章节及其祖先链（可折叠），让作者了解故事前情
- 中部：富文本编辑器（支持 Markdown 或所见即所得）
  - 实时字数/字节统计，标注 `[minChapterLength, maxChapterLength]` 范围
  - 超出范围时红色警告，禁止提交
  - 自动保存草稿到 localStorage（按 novelId + parentChapterId 键）
- 底部：提交区域
  - 显示所需保证金（`stakeAmount` ETH）
  - 预览按钮（渲染最终效果）
  - 提交按钮

**提交流程（两步交易，前端直传 Arweave）**
```
写作完成 → 点击 "Upload & Submit"
  → 前端校验长度范围
  → Step 1: 前端调用 Irys SDK 上传内容到 Arweave（用户 ETH 钱包支付存储费用）
    → 获取 Arweave txId
    → 计算 contentHash 和 declaredLength
  → Step 2: 前端调用 NovelCore.submitChapter(novelId, parentChapterId, contentHash, declaredLength)
    附带 stakeAmount ETH
  → 等待交易确认
  → 清除草稿 → 跳转到章节详情页
```

**草稿管理**
- localStorage 自动保存，按 `novel:{novelId}:parent:{parentChapterId}` 键存储
- 写作页面加载时自动恢复草稿
- 提交成功后清除对应草稿
- 用户中心可查看所有草稿列表

**创建小说（高级功能）**
- 独立页面：填写 NovelConfig 参数 + 编写创世章节
- Config 表单：各参数带说明和推荐值，降低理解门槛
  - 章节长度范围、Round 时间窗口、世界线数量 N、Epoch 轮数 K
  - 保证金金额、奖金释放率、投票者奖励比例
  - 内容存储 Base URL
- 创世章节：支持多章创世（动态添加/删除），每章独立编辑
- 初始奖金池（可选）：附带 ETH 数额
- 提交流程：上传所有创世章节内容 → 调用 `NovelCore.createNovel(config, hashes[], lengths[])` 附带 ETH

**Fork 小说（高级功能）**
- 在落选章节的阅读页或故事树中显示 "Fork" 按钮
- 进入 Fork 创建页：
  - 展示 fork 来源信息（源小说 + 源章节 + 故事前情）
  - 填写新小说的 NovelConfig（可基于源小说参数预填）
  - Fork 费用说明（>= 源小说 stakeAmount）
- 调用 `NovelCore.forkNovel(originalNovelId, branchChapterId, config)` 附带 ETH

#### 3.3 投票（需连接钱包）

**Round 投票**
- 阶段：Committing → Revealing
- Commit 阶段：
  - 展示当前 Round 所有候选章节（`getRoundSubmissions`）
  - 读者可阅读对比各候选章节
  - 选择候选 + 输入质押 ETH 数量
  - 前端生成随机 salt，计算 `commitHash = keccak256(candidateId, salt)`
  - **重要**：前端必须本地持久化 `{candidateId, salt}`，Reveal 阶段需要
  - 调用 `VotingEngine.commitVote(novelId, votingRoundId, commitHash)` 并附带质押 ETH
- Reveal 阶段：
  - 展示用户未 Reveal 的投票
  - 自动填充之前保存的 candidateId + salt
  - 调用 `VotingEngine.revealVote(novelId, votingRoundId, candidateId, salt)`
- 投票结果展示：
  - Settle 后展示各候选章节的得票数和排名
  - 标记世界线

**Epoch 投票**
- 与 Round 投票 UI 复用，候选对象从"章节"变为"世界线"
- 展示各世界线的完整故事摘要，方便对比

**投票记录**
- 用户历史投票列表（哪些 Round/Epoch 参与了、投给谁、是否已 Reveal）
- 当前可领取的投票奖励

#### 3.4 打赏（需连接钱包）

- 小说详情页的打赏按钮
- 输入 ETH 数量（最低 0.001 ETH）
- 调用 `PrizePool.tipNovel(novelId)` 并附带 ETH
- 打赏排行榜（按小说维度）
- 打赏历史记录

#### 3.5 奖励领取（需连接钱包）

**我的奖励面板**
- 投票奖励：按 Round 列出可领取奖励（质押返还 + 未揭示分配 + 准确性奖励）
  - 调用 `VotingEngine.claimVotingReward(novelId, votingRoundId)`
- 保证金退还：可领取的保证金余额
  - 调用 `NovelCore.claimStakeRefund(novelId)`
- 奖金池奖励（作者/创世者）：按小说列出待领取
  - 调用 `PrizePool.claimReward(novelId)`
- 一键领取所有

#### 3.6 举报（需连接钱包）

- 章节阅读页的举报按钮
- 输入举报理由 + 上传证据（生成 evidenceHash）
- 缴纳保证金（>= minBondAmount）
- 调用 `ReportRegistry.reportContent(novelId, chapterId, evidenceHash)`
- 举报状态追踪（待处理/已裁决-支持/已裁决-驳回）

#### 3.7 用户中心（需连接钱包）

- **我的创作**
  - 我创建的小说列表
  - 我提交的章节列表（含状态：候选中/世界线/Canon/落选，保证金状态：锁定/可退/已退/被罚没）
  - 我的草稿列表（从 localStorage 读取，可点击继续编辑）
- **我的投票**
  - 投票历史（哪些 Round/Epoch 参与了、投给谁、是否已 Reveal、奖励状态）
  - 待 Reveal 提醒（高优先级展示）
- **我的资产**
  - NFT 列表（Canon 章节的版权 NFT，含元信息和链接）
  - 奖励汇总（投票奖励 + 保证金退还 + 奖金池分成，按小说分组）
  - 一键领取所有可领取奖励
- 我参与的小说（作为作者/投票者/打赏者，聚合视图）

#### 3.8 评论系统

链上不存储评论。评论为链下功能：
- 章节评论：读者可在章节下方发表评论
- 存储在后端数据库
- 可选：连接钱包后评论（地址验证），或匿名评论
- 基础审核能力（敏感词过滤、举报）

#### 3.9 Fork 关系展示

Fork 是协议的重要机制——落选分支可以独立发展为新小说。前端需要清晰展示 fork 网络：

**小说详情页 — Fork 信息区**
- **Fork 来源**：如果是 fork 小说，展示 "Forked from Novel #X Chapter #Y"，可点击跳转到源小说和源章节
- **Fork 子代**：列出从本小说 fork 出去的所有子小说，每项显示 "Novel #Z (from Chapter #Y)"

**Fork 网络图**（小说维度）
- 以原始小说为根节点，展示所有 fork 关系的树状图
- 节点信息：Novel ID、状态（活跃/完结）、奖金池余额
- 点击跳转到对应小说详情页

**故事树中的 Fork 标注**
- 在故事树可视化中，被 fork 的章节节点上标注 fork 图标
- Hover/点击显示 "此章节被 fork 为 Novel #Z"

**数据来源**：`NovelForked` 事件索引到 `novels.fork_source_novel_id` 和 `novels.fork_source_chapter_id`

---

### 4. 数据模型（后端数据库）

```sql
-- 小说
novels (
  id              BIGINT PRIMARY KEY,    -- 链上 novelId
  creator         TEXT NOT NULL,          -- 创世者地址
  config          JSONB NOT NULL,         -- NovelConfig 全量
  current_round   INT,
  current_epoch   INT,
  round_phase     SMALLINT,              -- 0=Submitting,1=Committing,2=Revealing,3=Settling
  epoch_phase     SMALLINT,              -- 0=Rounds,1=Committing,2=Revealing,3=Settling
  phase_start_time TIMESTAMP,
  genesis_chapter_count INT,
  cumulative_canon_chapters INT,
  active          BOOLEAN DEFAULT TRUE,
  fork_source_novel_id  BIGINT,          -- NULL if original
  fork_source_chapter_id BIGINT,
  pool_balance    NUMERIC,               -- 定期同步或 event 驱动更新
  total_tipped    NUMERIC,
  total_funded    NUMERIC,               -- 历史累计奖金总额 (tips + genesis + slashed)
  view_count      BIGINT DEFAULT 0,      -- 页面访问计数 (热门排序依据)
  last_chapter_at TIMESTAMP,             -- 最近章节提交时间 (活跃排序依据)
  created_at      TIMESTAMP,
  block_number    BIGINT                 -- 创建区块
)

-- 章节
chapters (
  id              BIGINT PRIMARY KEY,    -- 链上 chapterId
  novel_id        BIGINT REFERENCES novels(id),
  parent_id       BIGINT,                -- 0 = genesis root
  author          TEXT NOT NULL,
  content_hash    TEXT NOT NULL,          -- bytes32 hex
  declared_length BIGINT,
  round           INT,
  epoch           INT,
  chapter_index   INT,                   -- 故事位置 (genesis=0)
  vote_count      NUMERIC DEFAULT 0,
  is_world_line   BOOLEAN DEFAULT FALSE,
  is_canon        BOOLEAN DEFAULT FALSE,
  content_text    TEXT,                   -- 缓存的章节正文
  content_fetched BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP,
  block_number    BIGINT
)

-- 投票记录 (从 events 索引)
votes (
  id              SERIAL PRIMARY KEY,
  novel_id        BIGINT,
  voting_round_id BIGINT,
  voter           TEXT NOT NULL,
  stake_amount    NUMERIC,
  revealed        BOOLEAN DEFAULT FALSE,
  candidate_id    BIGINT,                -- NULL until revealed
  claimed         BOOLEAN DEFAULT FALSE,
  commit_block    BIGINT,
  reveal_block    BIGINT
)

-- 打赏记录
tips (
  id              SERIAL PRIMARY KEY,
  novel_id        BIGINT REFERENCES novels(id),
  tipper          TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  tx_hash         TEXT,
  block_timestamp TIMESTAMP,
  block_number    BIGINT
)

-- 举报记录
reports (
  id              BIGINT PRIMARY KEY,    -- 链上 reportId
  novel_id        BIGINT,
  chapter_id      BIGINT,
  reporter        TEXT,
  evidence_hash   TEXT,
  bond_amount     NUMERIC,
  resolved        BOOLEAN DEFAULT FALSE,
  upheld          BOOLEAN,
  block_number    BIGINT
)

-- NFT 铸造记录
chapter_nfts (
  token_id        BIGINT PRIMARY KEY,
  novel_id        BIGINT,
  chapter_id      BIGINT,
  author          TEXT,
  epoch           INT,
  block_number    BIGINT
)

-- 评论 (纯链下)
comments (
  id              SERIAL PRIMARY KEY,
  chapter_id      BIGINT NOT NULL,       -- 链上 chapterId
  author_address  TEXT,                  -- NULL = 匿名
  content         TEXT NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP,
  deleted         BOOLEAN DEFAULT FALSE
)

-- Indexer 状态
indexer_state (
  id              INT PRIMARY KEY DEFAULT 1,
  last_block      BIGINT NOT NULL,       -- 已处理到的区块
  last_block_hash TEXT,                  -- 已处理区块的 hash (reorg 检测)
  last_finalized  BIGINT,               -- 已确认 (finalized) 的区块
  batch_size      INT DEFAULT 500,       -- 当前批次大小 (可动态调整)
  updated_at      TIMESTAMP DEFAULT NOW()
)
```

---

### 5. API 设计（主要端点）

```
GET  /api/novels                          -- 小说列表 (分页, 筛选, 排序)
GET  /api/novels/:id                      -- 小说详情
GET  /api/novels/:id/tree                 -- 故事树结构 (章节 parent 关系)
GET  /api/novels/:id/canon                -- Canon 章节链 (按 chapterIndex 排序)
GET  /api/novels/:id/worldlines           -- 当前活跃世界线
GET  /api/novels/:id/rounds/:round        -- Round 详情 (候选章节, 投票统计)
GET  /api/novels/:id/tips                 -- 打赏记录
GET  /api/novels/:id/stats                -- 统计 (章节数, 作者数, 投票数, 打赏总额)
GET  /api/novels/:id/forks                -- 从本小说 fork 出的子小说列表
GET  /api/novels/:id/fork-tree            -- Fork 网络图 (递归 fork 关系)
GET  /api/novels/ranking?sort=pool|tipped|hot|latest  -- 榜单排序

GET  /api/chapters/:id                    -- 章节详情 + 正文内容
GET  /api/chapters/:id/siblings           -- 同 parent 的平行分支
GET  /api/chapters/:id/children           -- 子章节列表
GET  /api/chapters/:id/context            -- 祖先章节链 (写作时的上下文)
GET  /api/chapters/:id/comments           -- 章节评论
POST /api/chapters/:id/comments           -- 发表评论

GET  /api/users/:address/novels           -- 用户参与的小说
GET  /api/users/:address/chapters         -- 用户提交的章节
GET  /api/users/:address/votes            -- 用户投票历史
GET  /api/users/:address/nfts             -- 用户持有的章节 NFT
GET  /api/users/:address/rewards          -- 用户可领取奖励汇总

WS   /ws/novels/:id                       -- 实时推送: 阶段变更, 新章节, 新投票, 新打赏
```

---

### 6. 关键交互流程

#### 6.1 阅读流程（无钱包）

```
首页 → 小说列表 → 点击小说卡片
  → 小说详情页 (元信息 + 故事树可视化)
  → 点击故事树节点 / 点击 "开始阅读"
  → 章节阅读页 (正文 + 上下文导航)
  → Canon 连续阅读模式
```

#### 6.2 续写流程（需钱包）

```
小说详情页 (Submitting 阶段) → 选择活跃世界线 → 点击 "续写"
  → 写作页面 (自动加载 parent 上下文 + 恢复草稿)
  → 编写内容 (实时字节校验, 自动保存草稿)
  → 点击预览 → 确认内容
  → 点击 "Upload & Submit"
  → Step 1: Irys 上传到 Arweave (ETH 钱包支付存储费)
  → Step 2: submitChapter 链上提交 (附带 stakeAmount ETH)
  → 交易确认 → 清除草稿 → 跳转到新章节页面
```

#### 6.3 投票流程（需钱包）

```
小说详情页 → 当前 Round 候选章节列表
  → 逐个阅读对比候选章节
  → 选择投票目标 + 输入质押 ETH
  → 确认交易 (commitVote)
  → [前端本地保存 salt]
  → ...等待 Reveal 阶段...
  → 收到通知 / 手动进入
  → 一键 Reveal (revealVote)
  → ...等待 Settle...
  → 领取奖励 (claimVotingReward)
```

#### 6.4 打赏流程（需钱包）

```
小说详情页 → 点击打赏按钮
  → 输入金额 (>= 0.001 ETH)
  → 确认交易 (tipNovel)
  → 打赏成功提示
```

---

### 7. 阶段状态展示

前端需要根据小说当前的 Round/Epoch 阶段展示不同 UI：

| Epoch 阶段 | Round 阶段 | 读者可见 | 作者可操作 | 投票者可操作 |
|-----------|-----------|---------|-----------|------------|
| Rounds | Submitting | 查看已提交章节（实时更新） | **续写章节 (submitChapter)** | — |
| Rounds | Committing | 查看候选章节列表 | — | 投票 (commitVote) |
| Rounds | Revealing | 查看投票进展 | — | 揭示 (revealVote) |
| Rounds | Settling | 等待结算 | — | — |
| Committing | — | 查看世界线对比 | — | Epoch 投票 (commitVote) |
| Revealing | — | 查看投票进展 | — | Epoch 揭示 (revealVote) |
| Settling | — | 等待 Epoch 结算 | — | — |

阶段倒计时：根据 `phaseStartTime + commitDuration/revealDuration/roundMinDuration` 计算剩余时间。

---

### 8. 非功能需求

- **性能**：章节内容后端缓存，首次获取后存入数据库，避免重复请求 IPFS/Arweave
- **SEO**：小说列表、章节阅读页 SSR/SSG，对搜索引擎友好
- **多链支持**：config 中支持切换 RPC/合约地址，初期只部署一条链
- **响应式设计**（Mobile First）：
  - 断点：mobile (< 640px) / tablet (640-1024px) / desktop (> 1024px)
  - 小说列表：mobile 单列卡片，tablet 双列，desktop 三列/列表切换
  - 章节阅读：全屏幕宽度排版，动态字号，舒适行距（1.8-2.0）
  - 故事树：mobile 简化为纵向时间线，tablet/desktop 完整树状图
  - 投票面板：mobile 底部抽屉，desktop 侧边栏
  - 钱包操作：适配移动端钱包（WalletConnect、MetaMask Mobile Deep Link）
  - 导航：mobile 底部 Tab Bar，desktop 顶部导航栏
- **国际化**：初期中文，预留 i18n 结构
- **钱包 UX**：
  - 未连接钱包时所有阅读功能正常，投票/打赏按钮提示连接钱包
  - 投票 salt 持久化到 localStorage，防止页面刷新丢失
  - 交易状态追踪（pending → confirmed → indexed），避免用户重复操作

---

### 9. 开发分期

**Phase 1 — MVP（阅读 + 续写 + 投票）**
- 后端：Event Indexer + REST API + 章节内容获取 + 内容上传代理 (Arweave/IPFS)
- 前端：小说列表/榜单、小说详情、故事树可视化、章节阅读、Canon 连读
- 创作：写作页面（富文本编辑器 + 字数校验 + 草稿自动保存）、续写提交流程
- 钱包：连接 + Round 投票（commit/reveal）+ 打赏

**Phase 2 — 完善体验**
- Epoch 投票 UI
- 创建小说（Config 表单 + 多章创世编辑）
- Fork 小说
- 奖励面板（投票奖励 + 保证金 + 奖金池奖励领取）
- 用户中心（我的创作/草稿/投票/NFT/奖励）
- 评论系统
- WebSocket 实时推送

**Phase 3 — 增强功能**
- 故事树高级可视化（缩放、搜索、筛选）
- Fork 网络图
- 打赏排行榜
- 举报系统
- 作者主页（创作统计、Canon 率、累计收益）
- 通知系统（阶段变更、Reveal 提醒、章节被投票/成为世界线通知）
- 多语言支持
