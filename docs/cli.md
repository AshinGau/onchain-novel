# CLI Design

Single npm package `onchain-novel-cli`: CLI command-line interaction + `setup` to generate MCP and skill configs.

## 1. Installation and Initialization

```bash
npm install -g onchain-novel-cli
onchain-novel-cli setup    # Generate ~/.onchain-novel/config.json + .mcp.json + .claude/commands/*.md
```

`setup` generates:
```
~/.onchain-novel/config.json         # CLI config (rpcUrl, privateKey, apiUrl, contracts, chainId)
.mcp.json                            # MCP server config
.claude/commands/
  |-- novel-author.md                # /novel-author -> writing workflow skill
  |-- novel-voter.md                 # /novel-voter -> voting workflow skill
  |-- novel-creator.md               # /novel-creator -> create/manage workflow skill
  +-- novel-reader.md                # /novel-reader -> browse/tip/bounty workflow skill
```

## 2. Subcommands

```bash
# Init and config
onchain-novel-cli setup
onchain-novel-cli config
onchain-novel-cli config set <key> <value>

# Novels
onchain-novel-cli novel create [options] --content "..."
onchain-novel-cli novel info <id>
onchain-novel-cli novel list [--sort latest|active] [--limit N]
onchain-novel-cli novel fork <chapter-id> [options] --content "..."
onchain-novel-cli novel complete <id>

# Chapters
onchain-novel-cli chapter submit <novel-id> <parent-id> --content "..." | --file <path>
onchain-novel-cli chapter read <chapter-id>
onchain-novel-cli chapter tree <novel-id>
onchain-novel-cli chapter descendants <chapter-id>

# Voting
onchain-novel-cli vote start <novel-id>
onchain-novel-cli vote nominate <novel-id> <chapter-id>
onchain-novel-cli vote commit <novel-id> <candidate-id> [salt]   # salt auto-generated if omitted; submits to backend for keeper-assisted reveal
onchain-novel-cli vote reveal <novel-id> <candidate-id> <salt>   # manual fallback; not needed if using keeper-assisted reveal
onchain-novel-cli vote settle <novel-id>
onchain-novel-cli vote claim <novel-id> <round>
onchain-novel-cli vote candidates <novel-id>

# Tips and bounties
onchain-novel-cli tip novel <novel-id> --value <eth>
onchain-novel-cli tip chapter <chapter-id> --value <eth>
onchain-novel-cli bounty create <chapter-id> --value <eth> --deadline <duration>
onchain-novel-cli bounty claim <bounty-id>
onchain-novel-cli bounty refund <bounty-id>

# Rules
onchain-novel-cli rule list <novel-id>
onchain-novel-cli rule set <novel-id> <name> <content>
onchain-novel-cli rule propose <novel-id> add|delete <name> [content]
onchain-novel-cli rule vote <proposal-id>

# Workflow guides
onchain-novel-cli guide author|voter|creator|reader
```

## 3. Data Sources

| Operation | Source |
|-----------|--------|
| Read operations (list, info, tree, candidates) | Backend REST API |
| Write operations (create, submit, commit, reveal) | Direct on-chain transactions (viem) |
| guide | Markdown embedded in npm package |

## 4. Directory Structure

```
cli/
  src/
    bin/onchain-novel-cli.ts # Entry point
    commands/                # One file per subcommand
    guides/                  # Embedded workflow docs
    shared/                  # ABI + contract wrappers (local copy)
    utils/                   # config, client, api, format
mcp/                         # separate package: onchain-novel-mcp
  src/
    shared/                  # ABI + contract wrappers (local copy)
    tools/
    utils/
```
