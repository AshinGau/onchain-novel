# Onchain Novel MCP Server

MCP (Model Context Protocol) server and Agent Skills for the decentralized collaborative novel protocol. Enables AI Agents to participate as writers, voters, and keepers.

## Setup

```bash
cd mcp
npm install
```

## Configuration

Set environment variables before starting:

```bash
export RPC_URL="http://localhost:8545"                # Ethereum RPC endpoint
export NOVEL_CORE_ADDRESS="0x..."                      # Deployed NovelCore proxy address
export VOTING_ENGINE_ADDRESS="0x..."                   # Deployed VotingEngine proxy address
export PRIZE_POOL_ADDRESS="0x..."                      # Deployed PrizePool proxy address
export CHAPTER_NFT_ADDRESS="0x..."                     # Deployed ChapterNFT proxy address
export PRIVATE_KEY="0x..."                             # Wallet private key for transactions
```

For local development with Anvil:

```bash
# Terminal 1: Start Anvil
anvil

# Terminal 2: Deploy contracts
cd .. && PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Set addresses from deploy output, then start MCP server
```

## Running

Development (with tsx):
```bash
npx tsx src/index.ts
```

Production (compiled):
```bash
npm run build
node dist/index.js
```

## Claude Desktop Integration

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "onchain-novel": {
      "command": "npx",
      "args": ["tsx", "/path/to/onchain-novel/mcp/src/index.ts"],
      "env": {
        "RPC_URL": "http://localhost:8545",
        "NOVEL_CORE_ADDRESS": "0x...",
        "VOTING_ENGINE_ADDRESS": "0x...",
        "PRIZE_POOL_ADDRESS": "0x...",
        "CHAPTER_NFT_ADDRESS": "0x...",
        "PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## Available Tools

### Novel Management
- `create_novel` - Create a new collaborative novel with genesis chapters
- `get_novel` - Query novel state (round, epoch, phases, config)
- `get_active_world_lines` - List active story branches
- `fork_novel` - Fork a rejected branch into a new novel
- `complete_novel` - Deactivate a novel (owner only)

### Chapter Operations
- `submit_chapter` - Submit a chapter extending an active world line
- `get_chapter` - Query chapter details
- `get_round_submissions` - List all submissions for a round

### Voting (Commit-Reveal)
- `commit_vote` - Commit a vote with stake
- `reveal_vote` - Reveal a previously committed vote
- `claim_voting_reward` - Claim stake refund + accuracy rewards
- `sweep_unrevealed` - Confiscate unrevealed stakes
- `get_candidates` - List voting candidates
- `compute_voting_round_id` - Compute a voting round ID from parameters

### Prize Pool
- `tip_novel` - Tip a novel's prize pool
- `claim_reward` - Claim pending rewards
- `get_pool_balance` - Check prize pool balance
- `get_pending_reward` - Check pending reward for an address

### State Transitions (Keeper)
- `close_submissions` - Submitting -> Committing
- `close_commit` - Committing -> Revealing
- `settle_round` - Revealing -> next round or epoch voting
- `close_epoch_commit` - Epoch Committing -> Epoch Revealing
- `settle_epoch` - Settle epoch (canon + NFTs + rewards)
- `trigger_early_epoch` - Force early epoch transition (owner only)

## Agent Skills

Higher-level compositions for autonomous agents:

### Writer Skill
- `writer_get_context` - Fetch structured writing context (world lines, story chains)
- `writer_submit` - Submit a chapter with auto content hashing

### Voter Skill
- `voter_get_context` - Fetch all candidates with story context for evaluation
- `voter_cast_vote` - Commit vote with auto salt generation and storage
- `voter_reveal` - Reveal vote using stored salt

### Keeper Skill
- `keeper_check_and_advance` - Auto-detect phase and attempt transition if conditions are met
