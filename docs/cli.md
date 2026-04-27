# CLI Design

Single npm package `onchain-novel-cli`, published as a single bundled artifact (tsup). Provides the full set of read + write operations against the protocol, plus a `setup` command that drops the consolidated workflow skill into the project for any agent ecosystem to pick up.

## 1. Setup

```bash
npm install -g onchain-novel-cli
onchain-novel-cli setup    # writes the skill + index + config.yaml
```

`setup` writes the **same** consolidated SKILL.md (covering all four roles) to two well-known locations, plus a root-level discovery file:

- `.agent/skills/onchain-novel/SKILL.md` -- standard `<skill>/SKILL.md` convention (Cursor / Cline / Anthropic Skill API / etc.).
- `.claude/commands/onchain-novel.md` -- Claude Code slash command, exposed as `/onchain-novel`.
- `onchain-novel-index.md` (project root) -- discovery hint for agents that don't auto-scan either skill path.

Configuration (RPC URL, API URL, contract addresses) is read from `config.yaml` at the repo root — the loader walks up from CWD. Override with `ONCHAIN_NOVEL_CONFIG=/path/to/config.yaml`. Contract addresses are populated automatically after `scripts/deploy.sh`.

Secrets are never persisted. Export your signer key before running write commands:

```bash
export PRIVATE_KEY=0x...
```

## 2. Subcommands

```bash
# Setup and config
onchain-novel-cli setup               # write SKILL.md to both .agent/ and .claude/ paths + index file
onchain-novel-cli config              # print current configuration (read-only)

# Novels
onchain-novel-cli novel create [options] --content "..."
onchain-novel-cli novel info <id>
onchain-novel-cli novel list [--sort latest|hot|pool|tipped|active] [--filter active|completed|all] [--limit N]
onchain-novel-cli novel fork <chapter-id> [options] --content "..."
onchain-novel-cli novel update-metadata <id> [--title <t>] [--description <d>] [--cover <uri>]
onchain-novel-cli novel complete <id>

# Chapters
onchain-novel-cli chapter submit <novel-id> <parent-id> --content "..." | --file <path>
onchain-novel-cli chapter read <chapter-id>
onchain-novel-cli chapter tree <novel-id>
onchain-novel-cli chapter children <chapter-id>
onchain-novel-cli chapter context <chapter-id>         # root → chapter ancestor chain with content
onchain-novel-cli chapter comments <chapter-id>
onchain-novel-cli chapter comment <chapter-id> <content>  # EIP-191 signed, off-chain

# Voting
onchain-novel-cli vote start <novel-id> <leaves>              # leaves = CSV of leaf chapter ids
onchain-novel-cli vote close-nomination <novel-id>            # keeper / owner, or anyone after timeout
onchain-novel-cli vote close-commit <novel-id>                # keeper / owner, or anyone after timeout
onchain-novel-cli vote nominate <novel-id> <chapter-id> [--forfeit]
onchain-novel-cli vote commit <novel-id> <candidate-id> [salt]
onchain-novel-cli vote reveal <novel-id> <candidate-id> [salt]    # manual fallback; salt falls back to local store
onchain-novel-cli vote settle <novel-id>
onchain-novel-cli vote claim <novel-id> <round>
onchain-novel-cli vote candidates <novel-id>
onchain-novel-cli vote discover                                # find active novels in Committing/Revealing phase
onchain-novel-cli vote status <novel-id>                       # personal commit/reveal status + local salt backups

# Tips and rewards
onchain-novel-cli tip novel <novel-id> --value <eth>
onchain-novel-cli tip chapter <chapter-id> --value <eth>
onchain-novel-cli tip claim <novel-id>                         # claim author/creator rewards

# Bounties
onchain-novel-cli bounty create <chapter-id> --value <eth> --deadline <duration>   # duration e.g. 7d, 24h
onchain-novel-cli bounty designate <bounty-id> <chapter-id>
onchain-novel-cli bounty list [--novel-id <id>]
onchain-novel-cli bounty info <bounty-id>
onchain-novel-cli bounty claim <bounty-id>
onchain-novel-cli bounty refund <bounty-id>

# Rules
onchain-novel-cli rule list <novel-id>
onchain-novel-cli rule set <novel-id> <name> <content>         # creator, epoch 1 only
onchain-novel-cli rule propose <novel-id> add|delete <name> <chapter-id> [content]
onchain-novel-cli rule vote <proposal-id> <chapter-id>
onchain-novel-cli rule proposal <proposal-id>

# User
onchain-novel-cli user set-nickname <nickname>
onchain-novel-cli user nickname [address]
onchain-novel-cli user votes [address]
onchain-novel-cli user chapters [address]
onchain-novel-cli user rewards [address]

# Workflow guide (consolidated, covers all four roles)
onchain-novel-cli guide
```

## 3. Data Sources

| Operation                                                  | Source                                   |
| ---------------------------------------------------------- | ---------------------------------------- |
| Read operations (list, info, tree, candidates, discover)   | Backend REST API                         |
| Write operations (create, submit, commit, reveal, nominate) | Direct on-chain transactions (viem)      |
| `chapter comment` / `vote commit --keeper-assisted`        | EIP-191 signed POST to backend API       |
| Local salt backup                                          | `~/.onchain-novel/vote-salts.json` (0600)|
| `guide`                                                    | Markdown embedded in npm package         |
