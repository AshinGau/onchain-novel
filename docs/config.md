# Configuration

All runtime configuration comes from `config.yaml` at the repo root.

## Schema

Validated by Zod at [`packages/shared/src/config.ts`](../packages/shared/src/config.ts):

```yaml
chain:
  rpcUrl: https://rpc-testnet.gravity.xyz/    # 目标链 RPC
  # chainId: 31337   # optional; auto-detected from rpcUrl if omitted
  nativeCurrency:                              # 非 ETH 链必须设置
    name: Gravity
    symbol: G
    decimals: 18

contracts:            # populated by scripts/deploy.sh — 勿手动编辑
  novelCore: "0x..."  # 唯一需要配置的合约地址；其余 6 个 on-chain 派生

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
  allowedDevOrigins:                           # HMR 跨域白名单
    - "127.0.0.1"
    - "localhost"
    - "192.168.*"

cli:
  apiUrl: http://127.0.0.1:3001               # Agent CLI 使用
```

## Secrets

密钥**绝不**写入 `config.yaml`，通过环境变量在进程启动时注入：

| 变量 | 用途 |
|------|------|
| `PRIVATE_KEY` | CLI 写入 / 合约部署 |
| `KEEPER_PRIVATE_KEY` | Keeper 钱包私钥 |
| `FAUCET_PRIVATE_KEY` | Faucet 钱包私钥 |
| `VOTE_ENCRYPTION_KEY` | 投票加密密钥 (32 字节 hex) |

## 消费者加载方式

| 消费者 | 方式 |
|--------|------|
| Backend (Express + indexer + keeper) | `loadConfig()` 启动时在 `web/backend/src/utils/env.ts` |
| Frontend (SSR + browser) | `loadConfig()` **构建时**在 `web/frontend/next.config.ts`，值编译进 bundle 为 `NEXT_PUBLIC_*` |
| CLI | `loadConfig()` 每次调用时从 `cli/src/utils/config.ts` (lazy; `--help` 不触发) |
| Shell 脚本 | `scripts/lib/read-config.sh` 包装 `yq eval` 读取单个 key |
| `scripts/patch-config.ts` | `forge script Deploy` 后将 NovelCore 代理地址写回 `config.yaml` |

## 部署流程

```bash
# 1. 安装依赖
./scripts/bootstrap.sh

# 2. 编辑 config.yaml（RPC URL、nativeCurrency、startBlock 等）

# 3. 部署合约 — 自动将 novelCore 地址写入 config.yaml
export PRIVATE_KEY=<redacted>
./scripts/deploy.sh

# 4. 构建前端（合约地址编译进 bundle）
npm run build:frontend

# 5. 启动服务
export KEEPER_PRIVATE_KEY=<redacted>
export FAUCET_PRIVATE_KEY=<redacted>
export VOTE_ENCRYPTION_KEY=$(openssl rand -hex 32)
./scripts/services.sh start --keeper
```

## 相关文件

- Schema source: [`packages/shared/src/config.ts`](../packages/shared/src/config.ts)
- 运维手册: [`ops.md`](../ops.md)
