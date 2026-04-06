# Economic Model Analysis -- Decentralized Collaborative Novel Protocol

> Version: 2026-04-03 | Status: living document

---

## 1. Fund Flow Overview

```
                        +------------------+
  Genesis injection --->|                  |
  Reader tips --------->|    Prize Pool    |
  Spam slashing -->|                  |
  Rule proposal fees -->|                  |
  Fork fees ----------->|                  |
                        +--------+---------+
                                 |
                          Epoch release
                       (poolBalance * rate)
                                 |
                    +------------+------------+
                    |                         |
             Protocol fee (opt)        Net release
                    |                         |
                    v               +---------+---------+
               Protocol addr        |                   |
                              Creator royalty      Remaining
                              1/(1+C) decay        |
                                    |        +-----+------+
                                    v        |            |
                               Creator    Author       Voter
                               wallet     rewards      reward pool
                                          (equal       (accuracy
                                           split)      weighted)

  --- Separate channel (no pool consumption) ---
  Unrevealed vote stakes --> redistributed to revealed voters (per round)

  --- Fixed per-call compensation ---
  Keeper rewards: small fixed amount per state transition
```

### Fund Source and Destination Table

| Source | Trigger | Destination |
|---|---|---|
| Genesis chapter injection | Creator calls `createStory` with value | Prize pool |
| Reader tips | Anyone calls `tip()` | Prize pool |
| Spam slashing | Spam vote passes, author stake seized | Prize pool |
| Fork fees | User forks a story | Prize pool |
| Rule proposal fees | User calls `proposeRule` with `ruleFee` | Prize pool |
| Unrevealed vote stakes | Voter fails to reveal before deadline | Revealed voters of same round |
| Keeper gas compensation | Protocol parameter (`keeperReward`) | Keeper address (from pool) |

---

## 2. Epoch Three-Layer Distribution

At the end of each epoch the contract releases funds from the pool and distributes them across three layers.

### Formulas

```
totalRelease = poolBalance * prizeReleaseRate / 10000      (max 50%)

1. Protocol fee   = totalRelease * protocolFeeRate / 10000  (max 10%, can be 0)

2. Creator royalty = (totalRelease - protocolFee) / (1 + C)
      where C = cumulative canon chapters accepted up to this epoch.
      G is fixed to 1 regardless of actual genesis chapter count.

3. remaining      = totalRelease - protocolFee - creatorRoyalty

4. Author rewards = remaining * (10000 - voterRewardRate) / 10000
      split equally among all canon-chapter authors in the epoch.

5. Voter reward pool = remaining - authorRewards
      distributed via accuracy-weighted shares (see Section 3).
```

### Creator Royalty Decay (fixed G = 1)

The creator royalty fraction of net release (after protocol fee) is `1 / (1 + C)`:

| Epoch | C (cumulative canon chapters) | Creator share of net release |
|-------|-------------------------------|------------------------------|
| 1     | 1                             | 50.0 %                       |
| 2     | 2                             | 33.3 %                       |
| 5     | 5                             | 16.7 %                       |
| 10    | 10                            | 9.1 %                        |
| 50    | 50                            | 2.0 %                        |

The curve guarantees the creator receives a meaningful early reward while the share asymptotically approaches zero, shifting value toward active contributors over time.

---

## 3. Voter Reward Model

Voter incentives operate on two independent layers.

### Layer 1 -- Unrevealed Stake Redistribution (per round, no pool consumption)

Every voting round uses a commit-reveal scheme. Voters who fail to reveal before the deadline forfeit their stake. The forfeited amount is redistributed proportionally among voters who did reveal in the same round. This mechanism is entirely self-contained and does not draw from the prize pool.

### Layer 2 -- Accuracy Rewards (epoch settlement)

At epoch settlement the voter reward pool (step 5 above) is divided among all participating voters using an accuracy-weighted system:

```
weight = 3   if the voter voted for the winning (canon) chapter
weight = 1   otherwise

voterShare_i = (stake_i * weight_i) / SUM(stake_j * weight_j)  for all j
reward_i     = voterRewardPool * voterShare_i
```

Accurate voters receive 3x the weight of inaccurate voters, incentivizing honest evaluation rather than strategic hedging.

---

## 4. Role Incentive Summary

| Role | Revenue | Costs | Motivation |
|---|---|---|---|
| **Creator** | Decaying royalty `1/(1+C)` of each epoch's net release | Initial genesis injection (ETH) | Seed a compelling story world; early royalty is substantial |
| **Author** | Equal share of author reward pool for accepted chapters | Time and effort writing; risk of spam slash | Creative contribution; recurring income while chapters are accepted |
| **Voter** | Layer 1: share of unrevealed stakes; Layer 2: accuracy-weighted epoch rewards | Stake locked during commit-reveal; gas costs | Curate quality; accurate voters earn 3x weight |
| **Keeper** | Fixed `keeperReward` per state-transition call | Gas cost of the transition transaction | MEV-like extraction; protocol liveness maintenance |
| **Tipper** | None (pure consumption) | Tip amount (ETH) | Support stories they enjoy; increases pool for all participants |

---

## 5. Attack Surface Analysis

### 5.1 Self-Vote

**Attack:** An author submits a chapter and votes for it with a second address to boost its chance of becoming canon.

**Mitigation:** The commit-reveal scheme hides vote targets during the commit phase, making coordination harder. The stake requirement makes self-voting costly -- if the chapter loses, the attacker still loses the accuracy multiplier (3x down to 1x). The economic break-even requires winning the canon slot, which is determined by total weighted votes, not just one voter. Net effect: the attacker pays real capital at risk with no guaranteed return.

### 5.2 Hedge Voting

**Attack:** A voter spreads stakes across multiple candidate chapters to guarantee partial accuracy rewards regardless of outcome.

**Mitigation:** The 3x/1x accuracy weighting means concentrated correct votes always outperform hedged portfolios. For a two-candidate race, betting 100% on the winner yields 3x weight, whereas splitting 50/50 yields `0.5*3 + 0.5*1 = 2x` average weight -- a 33% reduction in expected reward. The wider the candidate field, the worse hedging performs.

### 5.3 Sybil Attack

**Attack:** An attacker creates many addresses to multiply voting power or author slots.

**Mitigation:** All influence is stake-weighted, not address-weighted. Splitting the same capital across N addresses produces the same total weight as a single address. Author rewards are per-canon-chapter, not per-address, so Sybil authorship provides no additional reward unless multiple chapters are independently elected canon (which requires genuine community support).

### 5.4 Front-Running

**Attack:** A miner or MEV searcher observes a reveal transaction in the mempool and front-runs to extract information or manipulate outcomes.

**Mitigation:** The commit-reveal scheme ensures that the vote content is hidden behind a hash during the commit phase. Observing a reveal transaction discloses the vote, but by that point all commits are sealed -- the observer cannot change their own committed vote. Reveal-order manipulation does not affect outcome since all valid reveals are counted equally at deadline.

### 5.5 Genesis Inflation (FIXED)

**Vulnerability (old):** The original creator royalty formula was:

```
creatorRoyalty = netRelease * G / (G + C)
```

where `G = genesisChapterCount` (the number of bootstrap chapters created at story initialization). A malicious creator could submit many low-quality or trivially duplicated bootstrap chapters and inflate G. This dramatically increased their perpetual royalty share.

**Example of the old exploit:**

| G | C | Creator share |
|---|---|---------------|
| 1 | 10 | 9.1 % |
| 10 | 10 | 50.0 % |
| 10 | 50 | 16.7 % |

With G=10 the creator captured the same share at C=10 that should only occur at C=1, effectively stealing from authors and voters for the lifetime of the story.

**Fix:** The royalty formula now uses a fixed `G = 1` regardless of the actual number of genesis chapters:

```
creatorRoyalty = netRelease / (1 + C)
```

Multiple bootstrap chapters still serve their intended purpose -- building the story foundation as a linear chain -- but they no longer inflate the royalty calculation. The creator's share decays identically whether the story launched with 1 or 100 bootstrap chapters.

### 5.6 Non-Reveal Attack

**Attack:** A voter commits a stake but intentionally never reveals, either to grief the round or because the vote outcome is already decided and revealing would waste gas.

**Mitigation:** Unrevealed stakes are forfeited and redistributed to revealed voters (Layer 1 rewards). This makes non-reveal a guaranteed loss for the attacker and a windfall for honest participants. Rational voters always reveal if they have committed, because even an inaccurate reveal retains the 1x base weight in epoch settlement.

### 5.7 Keeper Front-Running

**Attack:** Multiple keepers race to call state-transition functions to claim the keeper reward, wasting gas across losing transactions.

**Mitigation:** The keeper reward is intentionally small -- enough to cover gas plus a modest margin, but not enough to justify aggressive MEV competition. The protocol relies on at least one rational keeper existing; it does not attempt to prevent races. In practice, keeper front-running is a liveness feature, not a vulnerability.

### 5.8 Pool Drain Attack

**Attack:** An attacker manipulates parameters or timing to drain the prize pool in a small number of epochs.

**Mitigation:** The `prizeReleaseRate` is capped at 50% (5000 / 10000) of the current pool balance per epoch. This geometric decay means the pool can never be fully drained in finite time. Even at maximum release rate, after N epochs the pool retains `balance * (0.5)^N`, ensuring long-term sustainability. Parameter changes are governance-controlled and bounded by contract-enforced maxima.

---

## 6. Known Limitations

### Low Participation Scenario

When few voters or authors participate in an epoch, rewards concentrate among a small group. This is mathematically correct but may create perceived unfairness or discourage new entrants. The protocol does not currently implement minimum-participation thresholds; an epoch with a single voter and a single author will distribute the full epoch release to those two parties.

### Keeper Reward Silent Failure

If no keeper calls the state-transition function, the protocol stalls. There is no on-chain fallback or automatic trigger. In low-activity periods, the keeper reward may be insufficient to attract any caller, requiring manual intervention or external automation (e.g., Chainlink Keepers, Gelato).

### Vote Claim Transfer Failure for Contract Addresses

Voter reward claims use native ETH transfers. If a voter address is a contract that reverts on `receive()` or `fallback()`, the claim transaction fails. The funds remain in the contract but are effectively locked for that voter. The protocol does not currently implement a pull-based withdrawal pattern or wrapped-ETH fallback for contract voters.

### Spam Record Persistence

When a chapter is voted as spam and the author is slashed, the spam record is stored on-chain permanently. There is no expiry, appeal, or reputation-recovery mechanism. A falsely accused author bears the record indefinitely, which may affect their participation in future story forks or related protocols.

---

## 7. Design Assessment

**Strengths:**

- **Decaying creator royalty** aligns creator incentive with long-term story health rather than rent-seeking. The fixed `G=1` formula closes the genesis inflation vector cleanly.
- **Commit-reveal voting** provides ballot secrecy without requiring trusted third parties or zero-knowledge infrastructure.
- **Stake-weighted participation** makes Sybil attacks economically neutral and rewards genuine capital commitment.
- **Geometric pool release** guarantees perpetual fund availability, preventing pool exhaustion under any parameter configuration.
- **Separation of voter reward layers** ensures that the unrevealed-stake penalty operates independently of epoch settlement, creating two reinforcing incentives for honest behavior.

**Design Principles:**

The economic model follows the governing rule: *simple, reliable, easy to upgrade*. Each formula uses basic arithmetic with no external oracle dependencies. Parameters are bounded by contract-enforced maxima to prevent governance mistakes. The layered distribution can be independently adjusted (protocol fee, release rate, voter share) without restructuring the overall flow.
