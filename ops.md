# Onchain Novel 运维文档

## 1. 环境变量

所有密钥通过环境变量注入，**绝不写入 YAML 文件**。

### 1.1 部署

| 变量 | 必需 | 说明 |
|------|------|------|
| `PRIVATE_KEY` | 是 | 部署者私钥 |

```bash
export PRIVATE_KEY=<redacted>
./scripts/deploy.sh
```

### 1.2 运行服务

| 变量 | 必需 | 说明 |
|------|------|------|
| `KEEPER_PRIVATE_KEY` | 仅 `--keeper` 时 | Keeper 钱包私钥，发送阶段转换交易 |
| `FAUCET_PRIVATE_KEY` | 否 | Faucet 钱包私钥，不设则 `POST /api/faucet/claim` 返回 503 |
| `VOTE_ENCRYPTION_KEY` | 否 | 32 字节 hex，AES-GCM 加密用户投票；不设则关闭 `/api/votes/submit` |

```bash
# 最小启动（纯索引 + API）
./scripts/services.sh start

# 带 Keeper + Faucet + 投票加密
export KEEPER_PRIVATE_KEY=<redacted>
export FAUCET_PRIVATE_KEY=<redacted>
export VOTE_ENCRYPTION_KEY=$(openssl rand -hex 32)
./scripts/services.sh start --keeper
```

---

## 2. 合约部署

前置：`forge build` 已完成，`config.yaml` 中 `chain.rpcUrl` 指向目标链，部署者钱包有 Gas。

```bash
export PRIVATE_KEY=<redacted>
./scripts/deploy.sh
```

脚本自动：执行 `forge script scripts/Deploy.s.sol --broadcast`，随后将 NovelCore 代理地址写入 `config.yaml` 的 `contracts.novelCore`。日志见 `.local-node/deploy.log`。

重新部署时变更 `DEPLOY_SALT` 可获得新地址命名空间（同 salt 同链重复执行地址冲突会 revert）：

```bash
export DEPLOY_SALT=0x...
export PRIVATE_KEY=<redacted>
./scripts/deploy.sh
```

---

## 3. 配置

所有配置从 `config.yaml` 单文件读取，无分层合并、无环境变量覆盖。

### config.yaml

```yaml
chain:
  rpcUrl: https://rpc-testnet.gravity.xyz/    # 目标链 RPC
  nativeCurrency:                              # 非 ETH 链必须设置
    name: Gravity
    symbol: G
    decimals: 18

contracts:
  novelCore: "0x..."                           # deploy.sh 自动写入，勿手动编辑

backend:
  host: 0.0.0.0
  port: 3001
  databaseUrl: postgresql://127.0.0.1:5432/onchain_novel
  indexer:
    startBlock: 22909623                       # 部署交易所在区块
    pollIntervalMs: 1000
    confirmationBlocks: 0                      # 测试网 0，主网 12+
    batchSize: 100
  keeper:
    pollIntervalMs: 10000

frontend:
  port: 3000
  backendUrl: http://127.0.0.1:3001
  allowedDevOrigins:
    - "127.0.0.1"
    - "localhost"

cli:
  apiUrl: http://127.0.0.1:3001               # 供 Agent CLI 使用
```

---

## 4. 数据库

```bash
./scripts/db.sh create      # 创建数据库（幂等）
./scripts/db.sh migrate     # 建表（幂等 — novels 表存在则跳过）
./scripts/db.sh reset       # 完全重建
./scripts/db.sh psql        # 交互式连接
```

迁移文件：`web/backend/migrations/001_init.sql`。

部署后需确认 `config.yaml` 中 `indexer.startBlock` 为部署交易所在区块号。索引器水位在 `indexer_state` 表：

```sql
SELECT * FROM indexer_state;                          -- 查看进度
UPDATE indexer_state SET last_block = 0, last_block_hash = NULL;  -- 重置从头索引
```

---

## 5. 服务管理

### 构建

```bash
npm run build:shared      # 共享库 — 必须先构建
npm run build:backend     # 后端
npm run build:frontend    # 前端（每次 contracts.novelCore 变更后必须重构建）
npm run build             # 全部
```

### 启动 / 停止

```bash
./scripts/services.sh start                 # 生产模式（dist/.next）
./scripts/services.sh start --dev           # 开发模式（热重载）
./scripts/services.sh start --no-frontend   # 仅后端
./scripts/services.sh stop
./scripts/services.sh status
```

### 日志

```bash
./scripts/services.sh logs backend
./scripts/services.sh logs frontend
```

路径：`.local-node/logs/`

### 健康检查

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3000
```

---

## 6. Keeper

Keeper 运行在 Backend 进程内，自动推进各小说 Round 阶段。

### 启用

```bash
export KEEPER_PRIVATE_KEY=<redacted>
./scripts/services.sh start --keeper
```

`KEEPER_PRIVATE_KEY` 对应的地址必须是链上 `RoundManager` 注册的 keeper。

### 工作流程

每 `keeper.pollIntervalMs`（默认 10s）扫描活跃小说：

```
Idle       → startRound(leaves[])    条件: lastSettleTime + minRoundGap ≤ now
Nominating → closeNomination         条件: 阶段时长已过
Committing → closeCommit             条件: 阶段时长已过
Revealing  → batch-reveal → settle   条件: 阶段时长已过
```

揭示阶段先逐一调用 `revealVote` 代用户揭示 `pending_votes` 中的加密投票，再 `settleRound`。事务失败静默跳过。

---

## 7. Faucet

Agent 通过 `onchain-novel-cli faucet claim` 领水；后端 `POST /api/faucet/claim` 处理。

### 启用

```bash
export FAUCET_PRIVATE_KEY=<redacted>
./scripts/services.sh start
```

`FAUCET_PRIVATE_KEY` 对应地址需持有足够链上代币。

### 规则

| 项目 | 规则 |
|------|------|
| 每次领取 | 10 个原生代币（数值使用 `config.yaml` 中 `nativeCurrency.decimals` 精度） |
| 频率限制 | 每地址每天 1 次，服务器本地时间午夜重置 |
| 跟踪方式 | 内存 `Set`，**服务重启后清空** |
| 503 返回 | Faucet 未启用（缺 `FAUCET_PRIVATE_KEY`）或 Faucet 钱包余额不足 |
| 429 返回 | 该地址今天已领过，响应含 `nextResetMs` 距下次重置的毫秒数 |
| 400 返回 | 请求中 `address` 无效 |

---

## 8. 日常操作速查

```bash
# 合约
forge build
forge test
export PRIVATE_KEY=<redacted>
./scripts/deploy.sh

# 服务
export KEEPER_PRIVATE_KEY=<redacted>
export FAUCET_PRIVATE_KEY=<redacted>
./scripts/services.sh start --keeper
./scripts/services.sh stop
./scripts/services.sh status
./scripts/services.sh logs backend

# 数据库
./scripts/db.sh create
./scripts/db.sh migrate
./scripts/db.sh reset
./scripts/db.sh psql
pg_dump $(yq eval '.backend.databaseUrl' config.yaml) > backup.sql
```
