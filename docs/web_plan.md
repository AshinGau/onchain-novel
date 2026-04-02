## Web Implementation Plan

### Phase 0 — Contract Changes (Before Web Development)

Web 应用依赖链上数据展示小说。当前合约缺少小说的展示性元数据（名称、简介等），且部分字段需要支持创建后修改。需先完成合约改动并部署，再开始 Web 开发。

#### 0.1 新增 Novel 元数据（NovelMetadata）

**问题**：`NovelConfig` 不包含小说名称、简介等信息，且设计为创建后不可变。Web 展示最基本的信息都没有。

**方案**：新增独立的 `NovelMetadata` 结构，与 `NovelConfig`（协议参数）分离。元数据可由 creator 修改。

```solidity
// DataTypes.sol
struct NovelMetadata {
    string title;       // 小说标题
    string description; // 小说简介
    string coverUri;    // 封面图 URI (IPFS/Arweave/HTTP)
}
```

**NovelCore 改动**：
- 新增存储：`mapping(uint256 => DataTypes.NovelMetadata) private _novelMetadata;`
- `createNovel()` 增加 `NovelMetadata calldata metadata` 参数
- `forkNovel()` 增加 `NovelMetadata calldata metadata` 参数
- 新增 `updateNovelMetadata(uint256 novelId, NovelMetadata calldata metadata)` — 仅 creator 可调用
- 新增 `getNovelMetadata(uint256 novelId)` view 函数
- 新增 events：`NovelMetadataUpdated(uint256 indexed novelId, string title, string description, string coverUri)`
- 标题校验：`bytes(metadata.title).length > 0`，限制最大长度（如 256 bytes）

#### 0.2 审查 NovelConfig 现有字段

逐字段检查 `NovelConfig` 是否需要调整：

| 字段 | 当前 | Web 需要 | 是否需改动 |
|------|------|---------|-----------|
| `minChapterLength` | 不可变 | 不可变 OK | 无 |
| `maxChapterLength` | 不可变 | 不可变 OK | 无 |
| `roundMinDuration` | 不可变 | 可考虑 creator 可调（但增加复杂度） | **暂不改** |
| `roundMinSubmissions` | 不可变 | 不可变 OK | 无 |
| `worldLineCount` | 不可变 | 不可变 OK（改变会破坏正在进行的 round） | 无 |
| `roundsPerEpoch` | 不可变 | 不可变 OK | 无 |
| `prizeReleaseRate` | 不可变 | 不可变 OK | 无 |
| `voterRewardRate` | 不可变 | 不可变 OK | 无 |
| `commitDuration` | 不可变 | 不可变 OK | 无 |
| `revealDuration` | 不可变 | 不可变 OK | 无 |
| `stakeAmount` | 不可变 | 可考虑 creator 可调（参与者需要知道当前值） | **暂不改** |
| `pollutionRounds` | 不可变 | 不可变 OK | 无 |
| `pollutionThreshold` | 不可变 | 不可变 OK | 无 |
| `contentBaseUrl` | 不可变 | 不可变 OK（内容寻址依赖一致性） | 无 |

**结论**：NovelConfig 本身不需改动。展示性信息全部放入 NovelMetadata。协议参数保持创建后不可变，避免引入规则变更的复杂性。

#### 0.3 合约改动任务清单

```
[x] DataTypes.sol: 新增 NovelMetadata struct
[x] INovelCore.sol: 更新 createNovel/forkNovel 签名, 新增 updateNovelMetadata/getNovelMetadata
[x] INovelCore.sol: 新增 NovelMetadataUpdated event
[x] NovelCore.sol: 新增 _novelMetadata mapping
[x] NovelCore.sol: createNovel() 接收并存储 metadata
[x] NovelCore.sol: forkNovel() 接收并存储 metadata
[x] NovelCore.sol: 新增 updateNovelMetadata() (onlyCreator)
[x] NovelCore.sol: 新增 getNovelMetadata() view
[x] 更新测试: 所有 createNovel/forkNovel 调用需传入 metadata 参数 (62/62 pass)
[x] 更新 MCP ABI + tools: 同步新签名
[x] 更新 e2e-test.sh: 同步新签名
[ ] 更新 deploy script (无需改动, deploy 不调用 createNovel)
[x] 运行 forge test -vv 全量通过
```

---

### Phase 1 — Reading (Core MVP)

目标：读者可以浏览和阅读链上小说，不需要钱包。UI 全英文。后续阶段的功能在 UI 上以占位形式存在（按钮可见但点击提示 "Coming Soon"）。

#### 1.1 Backend: Event Indexer ✅

```
[x] 项目初始化: Node.js + TypeScript + PostgreSQL + viem (web/backend/)
[x] 数据库 schema: novels, chapters, tips, votes, reports, chapter_nfts, comments, indexer_state (migrations/001_init.sql)
[x] Indexer 核心循环 (src/indexer/index.ts):
    - 分批拉取 eth_getLogs (可配置 batchSize)
    - 指数退避重试 (429/timeout/range-too-wide 分别处理)
    - 每批在单个 DB 事务中处理 (BEGIN/COMMIT/ROLLBACK)
    - indexer_state 进度记录 + block hash
[x] Event handlers (src/indexer/handlers.ts):
    - NovelCreated → insert novel + fetch metadata from chain
    - NovelForked → insert novel with fork source
    - NovelCompleted → update active=false
    - ChapterSubmitted → insert chapter + async content fetch
    - RoundPhaseChanged → update novel round_phase
    - EpochPhaseChanged → update novel epoch_phase
    - WorldLinesSelected → update chapters.is_world_line
    - CanonEstablished → trace chain + mark is_canon
    - NovelMetadataUpdated → update novel metadata
    - VoteCommitted/VoteRevealed/VotesTallied → insert/update votes
    - TipReceived → insert tip + update totals
    - ChapterNFTMinted → insert nft record
[x] 冷启动: 从 INDEXER_START_BLOCK 开始追赶
[x] 追到链头后切换轮询模式 (INDEXER_POLL_INTERVAL_MS)
[x] 多 RPC 端点容错 (RPC_FALLBACK_URLS, auto rotate)
[x] 健康检查: GET /health
```

#### 1.2 Backend: Content Fetcher ✅

```
[x] ChapterSubmitted 事件触发异步内容获取 (src/indexer/content-fetcher.ts)
[x] 根据 novel.config.contentBaseUrl + chapter.content_hash 拉取内容
[x] 存入 chapters.content_text, 标记 content_fetched=true
[x] 失败重试 (最多 5 次, 指数退避)
[x] 异步处理, 不阻塞 indexer 主循环
```

#### 1.3 Backend: REST API ✅

```
[x] GET /api/novels (分页, 排序: hot/pool/tipped/latest/active, 筛选)
[x] GET /api/novels/ranking (榜单)
[x] GET /api/novels/:id (详情 + metadata + config + 状态)
[x] GET /api/novels/:id/tree (故事树)
[x] GET /api/novels/:id/canon (Canon 章节链)
[x] GET /api/novels/:id/worldlines (活跃世界线)
[x] GET /api/novels/:id/rounds/:round (Round 候选)
[x] GET /api/novels/:id/forks (Fork 子小说)
[x] GET /api/novels/:id/stats (统计)
[x] GET /api/novels/:id/tips (打赏记录)
[x] GET /api/chapters/:id (章节详情 + 正文)
[x] GET /api/chapters/:id/siblings (平行分支)
[x] GET /api/chapters/:id/children (子章节)
[x] GET /api/chapters/:id/context (祖先链)
[x] GET /api/chapters/:id/comments (评论)
[x] 访问计数: novel/chapter 页面访问时 increment view_count
```

#### 1.4 Frontend: Project Setup ✅

```
[x] Next.js 16 (App Router) + TypeScript (web/frontend/)
[x] Tailwind CSS + shadcn/ui (badge, card, tabs, button, tooltip)
[x] wagmi + viem + RainbowKit (已安装, 阅读阶段不强制使用)
[x] 响应式布局:
    - mobile: 底部 Tab Bar (Discover/Vote/Write/Me)
    - desktop: 顶部导航栏 (Discover + Connect Wallet)
[x] Dark theme (neutral-950 bg)
```

#### 1.5 Frontend: Pages ✅

```
[x] Home / Discover page (app/page.tsx):
    - 5 ranking tabs: Hot / Highest Pool / Most Funded / Latest / Active
    - Novel cards: title, creator, phase badge, chapter count, pool balance (amber)
    - Responsive grid: 1-col mobile, 2-col tablet, 3-col desktop
[x] Novel detail page (app/novels/[id]/page.tsx):
    - Metadata: title, description, cover
    - Config params (collapsible details)
    - Round/Epoch + phase badge
    - Prize pool module (balance, total tipped, estimated next release)
    - Fork info + fork children list
    - Story tree visualization
    - Read Canon link
[x] Chapter reading page (app/chapters/[id]/page.tsx):
    - Chapter content (full text, whitespace-pre-wrap)
    - Navigation: parent ← / children list →
    - Metadata: author, chapterIndex, round/epoch, vote count
    - WorldLine / Canon badge
    - Siblings ("Other continuations from the same point")
[x] Canon reading mode (app/novels/[id]/canon/page.tsx):
    - Sequential reading along Canon chain (amber left border)
    - Chapter-by-chapter with author attribution
    - "Story continues..." / "The End" indicator
```

#### 1.6 Frontend: Story Tree Visualization ✅

```
[x] 分轮展示组件 (components/story-tree.tsx):
    - Chapters grouped by round
    - 颜色区分: Canon (amber) / WorldLine (blue) / Normal (neutral)
    - 节点: chapterIndex, author (truncated), vote count
    - 点击节点 → 跳转章节阅读页
[ ] 高级 D3/react-flow 树状图 → Phase 3
[ ] Mobile 纵向时间线 → Phase 3
```

#### 1.7 Frontend: Coming Soon Placeholders ✅

```
[x] Novel detail page:
    - "Tip this Novel — Coming Soon" button
    - "Write a Chapter — Coming Soon" button (Submitting 阶段)
    - "Vote — Coming Soon" button (Committing 阶段)
[x] Chapter reading page:
    - "Continue this story" → Coming Soon
    - "Report" → Coming Soon
    - "Comments coming soon" placeholder
[x] Header:
    - "Connect Wallet" → Coming Soon alert
    - "My Dashboard" → Coming Soon alert
[x] Mobile tab bar:
    - Vote / Write / Me tabs → Coming Soon alert
```

---

### Phase 2 — Tipping, Voting & Rewards ✅

目标：连接钱包后可以打赏、投票、领取奖励。

#### 2.1 Backend ✅

```
[x] Event handlers (已在 Phase 1 实现 + 补充):
    - TipReceived → insert tips, update novel.total_tipped (Phase 1)
    - VoteCommitted → insert vote record (Phase 1)
    - VoteRevealed → update vote.revealed + candidate_id (Phase 1)
    - VotesTallied → update chapter.vote_count (Phase 1)
    - StakeRefunded → insert stake_events (Phase 2)
    - StakeSlashed → insert stake_events (Phase 2)
    - VotingRewardClaimed → update vote.claimed + insert reward_claims (Phase 2)
    - RewardClaimed → insert reward_claims (Phase 2)
[x] 新增 migrations/002_stake_events.sql (stake_events + reward_claims 表)
[x] GET /api/novels/:id/tips — 打赏记录 (Phase 1)
[x] GET /api/users/:address/votes — 用户投票历史
[x] GET /api/users/:address/rewards — 奖励汇总 (unclaimed votes, stake events, reward claims)
[x] GET /api/users/:address/chapters — 用户提交的章节
[x] GET /api/users/:address/nfts — 用户 NFT 列表
[ ] WebSocket: /ws/novels/:id → Phase 3
```

#### 2.2 Frontend: Wallet Integration ✅

```
[x] wagmi + RainbowKit provider (components/providers.tsx)
[x] Contract ABIs + addresses (lib/contracts.ts, lib/wagmi-config.ts)
[x] ConnectButton 替换 Coming Soon (nav-bar.tsx)
[x] Dark theme RainbowKit (amber accent)
```

#### 2.3 Frontend: Tipping ✅

```
[x] TipButton 组件 (components/tip-modal.tsx)
    - 展开式 ETH 输入 (>= 0.001)
    - 调用 PrizePool.tipNovel() 附带 ETH
    - 交易状态追踪 (pending → confirming → success)
    - 未连接钱包时提示连接
[x] Novel detail page: 替换 Coming Soon 为真实 TipButton
```

#### 2.4 Frontend: Voting ✅

```
[x] VotePanel 组件 (components/vote-panel.tsx)
    - Committing phase: 候选章节列表, 选择 + 质押金额输入
    - 前端生成 salt (crypto.getRandomValues)
    - commitHash = keccak256(encodePacked(candidateId, salt))
    - localStorage 持久化 {candidateId, salt}
    - 调用 VotingEngine.commitVote()
    - Revealing phase: 自动加载保存的 vote data
    - 调用 VotingEngine.revealVote()
[x] Novel detail page: Committing/Revealing 阶段自动显示 VotePanel
[ ] Epoch 投票: 复用 Round VotePanel → Phase 3
```

#### 2.5 Frontend: Rewards & Dashboard ✅

```
[x] RewardsPanel 组件 (components/rewards-panel.tsx)
    - 链上读取 getPendingReward + getClaimableStake
    - Claim 按钮: claimReward / claimStakeRefund / claimVotingReward
    - 交易状态追踪
[x] Novel detail page: 连接钱包后显示 RewardsPanel
[x] Dashboard 页面 (app/dashboard/page.tsx):
    - My Chapters: 已提交章节列表 (状态标记: Canon/WL/普通)
    - My Votes: 投票历史 (Unrevealed/Claimable/Claimed 标记)
    - My NFTs: Canon 章节 NFT 列表
    - Rewards: 未领取投票奖励, Stake 历史, 已领取奖励
    - 紧急提醒: 待 Reveal 投票 (amber 高亮)
[x] Nav 更新: My Dashboard 链接替换 Coming Soon
```

---

### Phase 3 — Writing, Novel Creation & Full Features ✅

目标：人类作者可以在 Web 上续写、创建小说、Fork。完整功能上线。

> **存储方案决策**：采用 **Arweave + Irys 前端直传**。用户用 ETH 钱包直接支付 Arweave 存储费用，
> 无需后端代理上传。永久存储与链上协议的不可篡改理念一致。

#### 3.1 Arweave 上传集成 ✅

```
[x] 安装 @irys/web-upload + @irys/web-upload-ethereum-viem-v2
[x] lib/arweave.ts:
    - getIrysUploader(): ViemV2Adapter + window.ethereum provider
    - uploadText(content, tags?): 上传文本 → {txId, contentHash, declaredLength}
    - uploadFile(file): 上传文件 → txId
    - estimateCost(bytes): 预估费用
    - resetUploader(): 清除缓存实例
[x] contentHash = keccak256(arweaveTxId) as bytes32
[x] lib/contracts.ts: 新增 submitChapter, createNovel, forkNovel, getNovel ABIs
[x] lib/contracts.ts: 新增 REPORT_REGISTRY_ADDRESS + reportRegistryAbi
```

#### 3.2 Frontend: Chapter Writing ✅

```
[x] Writing page (app/write/[novelId]/[parentId]/page.tsx):
    - 上下文区域: parent 章节祖先链 (GET /api/chapters/:id/context)
    - Textarea 编辑器 + Write/Preview tab 切换
    - 实时字节统计 + [min, max] 范围校验 (红色警告)
    - 自动保存草稿到 localStorage (key: draft:{novelId}:{parentId})
    - 两步 "Upload & Submit" 流程 + 进度指示器
    - Step 1: Irys 上传 → Arweave txId → contentHash
    - Step 2: submitChapter 链上提交 + stakeAmount ETH
    - 成功后清除草稿, 跳转到小说页
[x] Novel detail page: "Write on World Line #X" 按钮替换 Coming Soon
[x] Chapter page: "Continue this story" 链接到 /write/{novelId}/{chapterId}
```

#### 3.3 Frontend: Novel Creation ✅

```
[x] Create Novel page (app/create/page.tsx):
    - NovelMetadata: title, description, cover image (Arweave upload)
    - NovelConfig: 分组表单 + 推荐默认值 + 描述说明
    - Genesis chapters: 动态添加/删除, 每章 textarea + 字节统计
    - Initial prize pool ETH 输入
    - 3-step 提交: 上传 genesis → 上传 cover → createNovel 链上调用
[x] Nav: "Create Novel" 链接 (desktop + mobile)
```

#### 3.4 Frontend: Fork Novel ✅

```
[x] Chapter page: 非 Canon 章节显示 "Fork from here" 按钮
[x] Fork page (app/fork/[novelId]/[chapterId]/page.tsx):
    - 展示 fork 来源信息
    - NovelMetadata form
    - NovelConfig form (源小说参数预填)
    - Fork 费用说明 + ETH 输入
    - forkNovel 链上调用
```

#### 3.5 Frontend: User Center (Complete) ✅

```
[x] Dashboard Drafts tab: localStorage 草稿列表, 编辑/删除
    (My Chapters / My Votes / My NFTs / Rewards 已在 Phase 2 实现)
```

#### 3.6 Comments & Reporting ✅

```
[x] Backend: POST /api/chapters/:id/comments (author_address 可选)
[x] Backend: DELETE /api/chapters/:id/comments/:commentId (作者 soft delete)
[x] CommentSection 组件: 评论列表 + 连接钱包后发表 + 删除自己的评论
[x] Chapter page: 评论区替换 "Comments coming soon"
[x] ReportModal 组件:
    - 理由选择 (Plagiarism/Abuse/Spam/Other)
    - 证据描述 → Arweave 上传 → evidenceHash
    - ReportRegistry.reportContent() + bond ETH
    - 交易状态追踪
[x] Chapter page: Report 按钮替换 Coming Soon
```

#### 3.7 Epoch Voting ✅

```
[x] VotePanel 复用, 候选改为 worldlines (epoch_phase=1/2 时显示)
[x] computeVotingRoundId(): 前端精确计算 keccak256(novelId, epoch, round, isEpoch) 匹配合约
[x] 同时修复了 Round 投票的 votingRoundId (之前是伪造字符串, 现在正确计算)
[x] VotePanel 增加 title prop 区分 "Round X Vote" / "Epoch X Vote — Choose Canon"
[x] Novel detail page: epoch_phase=1 显示 Epoch Commit, epoch_phase=2 显示 Epoch Reveal
```

#### 3.8 Notification System ✅

```
[x] Backend: notifications 表 (migrations/003_notifications.sql)
    - recipient (NULL=broadcast to novel participants), type, title, message, link, read
[x] Backend: notifications.ts 工具函数 (createNotification, createRevealReminders)
[x] Backend: Event handlers 集成:
    - RoundPhaseChanged → broadcast "Phase changed to X"
    - RoundPhaseChanged (Revealing) → 个人提醒 "Reveal your vote!"
    - EpochPhaseChanged → broadcast "Epoch phase changed to X"
    - EpochPhaseChanged (Revealing) → 个人提醒 "Reveal your epoch vote!"
    - CanonEstablished → broadcast "Canon established, NFTs minted"
[x] Backend: REST API (api/notifications.ts):
    - GET /:address — 用户通知列表 (个人 + 参与小说的广播)
    - GET /:address/unread-count — 未读数
    - POST /:address/mark-read — 标记已读
[x] Frontend: NotificationBell 组件 (components/notification-bell.tsx):
    - 铃铛图标 + 未读计数红点
    - 下拉通知列表 (类型图标: 🔄 phase / ⚠️ reveal / 🏆 canon)
    - 点击跳转到对应页面
    - "Mark all read" 按钮
    - 30 秒轮询刷新
[x] Nav bar: 铃铛图标集成在 ConnectButton 左侧
```

#### 3.9 Future Enhancements

```
[ ] WebSocket: /ws/novels/:id — 实时推送 (替代轮询)
[ ] Fork network graph (D3.js)
[ ] Story tree: D3/react-flow 可交互树状图
[ ] Author profile page
[ ] Tip leaderboard
[ ] i18n: 中文支持
```

---

### Timeline Summary

```
Phase 0  Contract changes     ██░░░░░░░░░░░░░░░░░░
Phase 1  Reading MVP           ░░██████░░░░░░░░░░░░
Phase 2  Tip + Vote + Rewards  ░░░░░░░░████░░░░░░░░
Phase 3  Writing + Full        ░░░░░░░░░░░░████████
```

### Frontend UI Language

All user-facing text in **English**. Examples:
- "Discover Novels" / "Hot" / "Highest Pool" / "Latest"
- "Start Reading" / "Continue Reading" / "Canon Timeline"
- "Tip this Novel" / "Vote" / "Reveal Vote" / "Claim Rewards"
- "Write a Chapter" / "Submit" / "Preview" / "Save Draft"
- "Coming Soon" (for placeholder features)
- "Connect Wallet" / "My Creations" / "My Votes" / "My Rewards"
