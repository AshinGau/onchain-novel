# Backend 设计（Indexer + REST API + Keeper）

事件索引器 + 只读查询 API + 可选 Keeper 服务。

## 1. 目录结构

```
web/backend/src/
  index.ts                # Express server + indexer + keeper + 后台任务启动
  db/                     # PostgreSQL 连接 + 迁移（单个 001_init.sql，从零开始）
  indexer/
    index.ts              # 事件轮询循环（自适应 batch、RPC 轮换、重试）
    handlers.ts           # 事件处理器（解析事件 → 写 DB）
    content-fetcher.ts    # External/HTTP 模式内容拉取 + 重试
  keeper/
    index.ts              # 自动 keeper：扫描活跃小说，触发 phase 转换
  api/
    novels.ts             # 小说列表/详情/tree/worldlines/rounds/forks/stats/tips
    chapters.ts           # 章节详情/children/context/siblings/comments/bounties/tips
    users.ts              # 用户投票/奖励/章节历史
    bounties.ts           # 悬赏查询
    rules.ts              # 规则/提案查询
    content.ts            # 内容 hash 计算（External/HTTP 辅助）
  utils/
    abi.ts                # 合约 ABI（从 shared 包重新导出）
    env.ts                # 环境变量
    validate.ts           # 请求参数校验
    auth.ts               # EIP-191 签名验证（评论鉴权）
    pool-sync.ts          # 定时从链上同步 prize pool 余额
```

## 2. Indexer

- 轮询链上事件，监听 5 个合约地址（NovelCore、VotingEngine、PrizePool、BountyBoard、RulesEngine）
- 自适应 batch size + RPC 轮换 + 指数退避重试
- 每批事件在单个 DB 事务中处理，单条事件失败不影响整批
- 确认块数（`INDEXER_CONFIRMATION_BLOCKS`）防重组

## 3. Keeper 服务

可选，配置 `KEEPER_PRIVATE_KEY` 后启动。从 DB 读取小说状态，自动触发 phase 转换。

```
每 N 秒扫描活跃小说:
  Idle     && lastSettleTime + minRoundGap <= now     → startRound(novelId)
  Nominating && phaseStartTime + nominateDuration <= now → closeNomination(novelId)
  Committing && phaseStartTime + commitDuration <= now   → closeCommit(novelId)
  Revealing  && phaseStartTime + revealDuration <= now   → settleRound(novelId)
```

发交易失败（已被其他 keeper 执行）静默跳过。不配置则 backend 退化为纯 indexer + API。

## 4. REST API

| 端点 | 说明 |
|------|------|
| `GET /api/novels` | 列表（分页、排序、搜索、过滤） |
| `GET /api/novels/:id` | 详情（含 config、phase、round 信息） |
| `GET /api/novels/:id/tree` | 章节树 |
| `GET /api/novels/:id/worldlines` | 当前世界线 |
| `GET /api/novels/:id/rounds/:round` | 投票轮次数据 |
| `GET /api/novels/:id/forks` | Fork 列表 |
| `GET /api/novels/:id/stats` | 统计 |
| `GET /api/novels/:id/tips` | 打赏记录 |
| `GET /api/novels/:id/bounties` | 悬赏列表 |
| `GET /api/novels/:id/rules` | 规则列表 |
| `GET /api/novels/:id/rule-proposals` | 规则提案 |
| `GET /api/chapters/:id` | 章节详情 |
| `GET /api/chapters/:id/children` | 子章节 |
| `GET /api/chapters/:id/context` | 祖先链（含 content_text） |
| `GET /api/chapters/:id/siblings` | 兄弟章节 |
| `GET /api/chapters/:id/comments` | 评论 |
| `GET /api/chapters/:id/bounties` | 章节悬赏 |
| `GET /api/chapters/:id/tips` | 章节打赏 |
| `GET /api/bounties/:id` | 悬赏详情 |
| `GET /api/users/:address/votes` | 用户投票历史 |
| `GET /api/users/:address/rewards` | 用户奖励 |
| `GET /api/users/:address/chapters` | 用户章节 |
| `POST /api/content/upload` | 内容 hash 计算 |
