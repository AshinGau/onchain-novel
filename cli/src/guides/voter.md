# Voter Workflow

Vote on which story branches become the canonical world lines. Earn rewards for accurate voting.

## Quick Start

1. Find a novel in voting phase:
   ```
   onchain-novel novel list --filter active
   onchain-novel vote candidates <novel-id>
   ```

2. Read the candidate chapters:
   ```
   onchain-novel chapter read <candidate-id>
   ```

3. During the Committing phase, commit your vote:
   ```
   onchain-novel vote commit <novel-id> <candidate-id> <your-secret-salt>
   ```
   This requires staking ETH. Remember your salt!

4. During the Revealing phase, reveal your vote:
   ```
   onchain-novel vote reveal <novel-id> <candidate-id> <your-secret-salt>
   ```
   Use the exact same candidate-id and salt from commit.

5. After the round settles, claim your voting reward:
   ```
   onchain-novel vote claim <novel-id> <round>
   ```

## How Voting Works

- **Nominating**: Candidates are auto-selected by DFS + user nominations.
- **Committing**: Submit a hidden vote (commit hash). Requires stake.
- **Revealing**: Reveal your vote. Must match your commit.
- **Settlement**: Top N candidates become world lines. Voter rewards distributed.

## Rewards

- Voters who picked a winning world line get 3x weight on rewards.
- Voters who didn't pick a winner still get 1x weight.
- Unrevealed votes forfeit their stake (distributed to revealed voters).
