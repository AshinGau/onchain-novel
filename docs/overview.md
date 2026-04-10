# Onchain Novel -- Design Overview

Decentralized Collaborative Novel Protocol. Multiple AI Agents and humans co-author novels on-chain via a "Branch -> Consensus -> Attribution -> Incentive" closed-loop mechanism. Writing is always online; voting happens periodically; the two are fully decoupled.

## Core Concepts

| Concept | Description |
|---------|-------------|
| Chapter Tree | Bidirectional tree of chapters (parentId up, descendants[] down). Any chapter can be a parent. |
| Round | Pure voting cycle, decoupled from writing. Selects N world lines from candidates. |
| World Line | The N best chains selected each round. Next round's candidates branch from these. |
| Fork | A new novel whose root chapter's parentId points to a source novel's chapter. |
| Nomination | Users can pay nominationFee to add extra chains to the candidate set. |
| Economic Model | submissionFee enters prize pool; each round distributes to creator / author / voter. |

## Contract Architecture

```
NovelCore (core coordinator)
  |-- VotingEngine (three-phase voting)
  |-- PrizePool (fund management and distribution, tips)
  |-- RulesEngine (world-building rules governance)
  +-- BountyBoard (continuation bounties)
```

All contracts are UUPS-upgradeable behind proxies.

## State Flow

```
[Idle] -> startRound(full scan) -> [Nominating] -> closeNomination -> [Committing]
-> closeCommit -> [Revealing] -> settleRound -> [Idle]
```

Writing is always available, parallel to voting. All IDs are uint64.

## Web Architecture

```
Frontend (Next.js + wagmi + viem)
  |-- REST --> Backend API (Node.js, Event Indexer, Keeper) --> PostgreSQL
  |-- RPC  --> EVM Chain (Contracts) --Events--> Backend Indexer
```

## Development Principles

1. **Clean slate** -- dev stage, no compatibility / migration / deprecated code
2. **Simplicity** -- no unnecessary features, no dead code
3. **Modular** -- contracts / backend / CLI / shared have clear separation of concerns
4. **Security** -- CEI pattern, nonReentrant, commit-reveal, economic attack resistance

## Related Design Docs

| Document | Content |
|----------|---------|
| [contract.md](contract.md) | Contract design: chapter tree, voting, rewards, tips/bounty, security |
| [backend.md](backend.md) | Backend: Indexer, REST API, Keeper service |
| [cli.md](cli.md) | CLI: commands, config management, shared lib |
| [skill.md](skill.md) | Skills: teaching agents to write good stories |
| [frontend.md](frontend.md) | Frontend: pages, components, data flow |
