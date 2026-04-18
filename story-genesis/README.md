# Story Genesis

34 pre-written novels for bootstrapping the Onchain Novel platform. Each novel contains 3 chapters, a rules file, and a description.

## Directory Structure

```
story-genesis/
  01-九龙城寨消失的房间/
    chapter-1.txt      # Bootstrap chapter 1
    chapter-2.txt      # Bootstrap chapter 2
    chapter-3.txt      # Bootstrap chapter 3
    rules.md           # World-building rules
    description.md     # Novel synopsis (< 100 chars, starts with genre tag)
  02-the-silk-road-murders/
    ...
  ...
  34-colony-zero/
    ...
  init.sh              # One-click initialization script
  create-novels.mjs    # Node.js script that creates novels on-chain
```

## Usage

1. Start the local development stack:

```bash
./scripts/dev.sh start
```

2. Initialize all 34 novels on-chain:

```bash
./story-genesis/init.sh
```

This will:
- Create 34 novels via `NovelCore.createNovel` with 3 bootstrap chapters each
- Set creator rules (named "story setting") via `RulesEngine.setCreatorRules`
- Assign a random initial prize pool of 1-10 ETH per novel
- Use test account `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (Anvil account #1)

## Configuration

All novels use the default config defined in `create-novels.mjs`:

| Parameter          | Value                        |
| ------------------ | ---------------------------- |
| Content storage    | Onchain                      |
| submissionFee      | 0.005 ETH                    |
| voteStake          | 0.001 ETH (≤ submissionFee)  |
| nominationFee      | 0.01 ETH                     |
| nominateDuration   | 1 day                        |
| commitDuration     | 3 days                       |
| revealDuration     | 2 days                       |
| minRoundGap        | 2 days                       |
| worldLineCount     | 2                            |
| prizeReleaseRate   | 20% (2000 bps)               |
| voterRewardRate    | 15% (1500 bps)               |
| ruleFee            | 0.001 ETH                    |
| ruleVoteDuration   | 3 days                       |
| ruleQuorum         | 7                            |
| Initial prize pool | Random 1–10 ETH per novel    |

## Genre Coverage

The 34 novels span: crime/mystery, horror/supernatural, romance, literary fiction, coming-of-age, wuxia (martial arts), epic fantasy, urban fantasy, science fiction, LitRPG, and rebirth. 20 in Chinese, 14 in English.
