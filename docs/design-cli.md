# CLI 设计

单一 npm 包 `onchain-novel`，提供 CLI 命令行交互 + `setup` 生成 MCP 和 skill 配置。

## 1. 安装与初始化

```bash
npm install -g onchain-novel
onchain-novel setup    # 生成 ~/.onchain-novel/config.json + .mcp.json + .claude/commands/*.md
```

`setup` 生成：
```
~/.onchain-novel/config.json         # CLI 配置（rpcUrl, privateKey, apiUrl, contracts, chainId）
.mcp.json                            # MCP server 配置
.claude/commands/
  ├── novel-author.md                # /novel-author → 写作工作流 skill
  ├── novel-voter.md                 # /novel-voter → 投票工作流 skill
  ├── novel-creator.md               # /novel-creator → 创建/管理工作流 skill
  └── novel-reader.md                # /novel-reader → 浏览/打赏/悬赏工作流 skill
```

## 2. 子命令

```bash
# 初始化与配置
onchain-novel setup
onchain-novel config
onchain-novel config set <key> <value>

# 小说
onchain-novel novel create [options] --content "..."
onchain-novel novel info <id>
onchain-novel novel list [--sort latest|active] [--limit N]
onchain-novel novel fork <chapter-id> [options] --content "..."
onchain-novel novel complete <id>

# 章节
onchain-novel chapter submit <novel-id> <parent-id> --content "..." | --file <path>
onchain-novel chapter read <chapter-id>
onchain-novel chapter tree <novel-id>
onchain-novel chapter descendants <chapter-id>

# 投票
onchain-novel vote start <novel-id>
onchain-novel vote nominate <novel-id> <chapter-id>
onchain-novel vote commit <novel-id> <candidate-id> <salt>
onchain-novel vote reveal <novel-id> <candidate-id> <salt>
onchain-novel vote settle <novel-id>
onchain-novel vote claim <novel-id> <round>
onchain-novel vote candidates <novel-id>

# 打赏与悬赏
onchain-novel tip novel <novel-id> --value <eth>
onchain-novel tip chapter <chapter-id> --value <eth>
onchain-novel bounty create <chapter-id> --value <eth> --deadline <duration>
onchain-novel bounty claim <bounty-id>
onchain-novel bounty refund <bounty-id>

# 规则
onchain-novel rule list <novel-id>
onchain-novel rule set <novel-id> <name> <content>
onchain-novel rule propose <novel-id> add|delete <name> [content]
onchain-novel rule vote <proposal-id>

# 工作流指南
onchain-novel guide author|voter|creator|reader
```

## 3. 数据来源

| 操作 | 来源 |
|------|------|
| 读操作（list, info, tree, candidates） | backend REST API |
| 写操作（create, submit, commit, reveal） | 直接链上交易（viem） |
| guide | npm 包内嵌 markdown |

## 4. 目录结构

```
cli/
  src/
    bin/onchain-novel.ts     # 入口
    commands/                # 每个子命令一个文件
    guides/                  # 内嵌工作流文档
    utils/                   # config, client, api, format
shared/
  src/
    abi.ts                   # 合约 ABI（单一源）
    contracts.ts             # 链交互封装
    config.ts                # 配置类型
```

`shared` 包被 CLI 和 backend 共同依赖，避免 ABI 重复。
