# 🔮 去中心化协作式小说协议

部署在 EVM 兼容链上的智能合约平台，通过 **"分支 → 共识 → 确权 → 激励"** 闭环机制，让全网用户和 AI Agent 共同创作高质量文学作品。

## ✨ 核心功能

- **协作续写**: 任何人可在活跃世界线上提交续写章节
- **Commit-Reveal 投票**: 社区投票选出最精彩的故事发展方向
- **多世界线机制**: 每轮保留 N 条平行世界线，Epoch 收束为唯一 Canon
- **奖金池激励**: 创世者注入 + 读者打赏 → Epoch 按贡献分配给主线作者
- **版权 NFT**: 入选 Canon 的章节自动铸造 ERC-721 版权证明 NFT
- **链上分叉**: 落选分支可 Fork 为独立新小说

## 🏗️ 合约架构

```
┌─────────────────────────────────────────────────────┐
│                    UUPS Proxy Layer                  │
├──────────┬──────────────┬───────────┬────────────────┤
│NovelCore │ VotingEngine │ PrizePool │  ChapterNFT    │
│状态机     │ Commit-Reveal│ 奖金管理   │  ERC-721       │
│章节树     │ 投票引擎      │ 打赏 & 分配│  版权 NFT      │
│协调中枢   │ 多种权重策略  │ Pull 领取  │  元数据管理     │
└──────────┴──────────────┴───────────┴────────────────┘
```

| 合约 | 职责 |
|------|------|
| **NovelCore** | 创建小说、续写提交、Round/Epoch 状态机、保证金管理、污染追踪 |
| **VotingEngine** | Commit-Reveal 二阶段投票、计票排序、Schelling 奖励 |
| **PrizePool** | 创世注入、读者打赏、Epoch 按比例释放、Pull 模式领取 |
| **ChapterNFT** | ERC-721 铸造、章节版权证明、元数据查询 |

## 🚀 快速开始

### 环境准备

```bash
# 安装 Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 克隆项目
git clone <repo-url>
cd onchain-novel
```

### 编译

```bash
forge build
```

### 测试

```bash
forge test -vv
```

### 部署（本地 Anvil）

```bash
# 启动本地节点
anvil

# 部署
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

## 📁 项目结构

```
src/
├── core/
│   ├── NovelCore.sol          # 核心：小说生命周期 + 状态机
│   ├── VotingEngine.sol       # Commit-Reveal 投票引擎
│   ├── PrizePool.sol          # 奖金池管理
│   └── ChapterNFT.sol         # ERC-721 版权 NFT
├── interfaces/
│   ├── INovelCore.sol
│   ├── IVotingEngine.sol
│   ├── IPrizePool.sol
│   ├── IChapterNFT.sol
│   └── IReportRegistry.sol    # 举报接口（预留）
└── libraries/
    └── DataTypes.sol           # 共享数据结构
test/
└── Integration.t.sol           # 全流程集成测试
script/
└── Deploy.s.sol                # UUPS 代理部署脚本
```

## 🔄 生命周期

```
创建小说 → [Round 1..K] → Epoch 投票 → Canon 确立 → NFT 铸造 + 奖金分配 → 下一个 Epoch
              │
              └── 续写提交 → Commit → Reveal → 选出 top N 世界线 → 下一轮
```

## 📋 设计文档

详细需求设计见 [design_cn.md](./design_cn.md)。

## 🔐 安全说明

- 所有 ETH 转移函数使用 `ReentrancyGuard` 防重入
- 奖金领取使用 Pull 模式（CEI 模式），防 DoS
- 合约通过 UUPS Proxy 可升级，升级权限由 `owner` 控制
- 提交保证金防垃圾投稿，仅违规（字数不达标/持续污染）时罚没

## 📜 License

MIT
