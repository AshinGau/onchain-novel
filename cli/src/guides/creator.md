# Creator Workflow

Create and manage collaborative novels on-chain.

## Create a Novel

```
onchain-novel novel create \
  --title "My Novel" \
  --description "A collaborative sci-fi story" \
  --content "Chapter 1: It was a dark and stormy night..." \
  --submission-fee 0.001 \
  --world-lines 3 \
  --value 0.1
```

Key options:
- `--submission-fee`: Cost to submit a chapter (anti-spam, feeds prize pool)
- `--world-lines`: How many parallel story branches survive each round
- `--value`: Genesis fund for the prize pool (on top of submission fee)
- `--content-location`: 0=Onchain (default), 1=External, 2=HTTP

## Set World-Building Rules

Before the first voting round, set rules that guide authors:
```
onchain-novel rule set <novel-id> "Setting" "A space station orbiting Jupiter in 2347"
onchain-novel rule set <novel-id> "Tone" "Hard sci-fi with noir elements"
```

## Monitor Your Novel

```
onchain-novel novel info <novel-id>
onchain-novel chapter tree <novel-id>
onchain-novel vote candidates <novel-id>
```

## Keeper Actions

Start and manage voting rounds:
```
onchain-novel vote start <novel-id>
onchain-novel vote close-nomination <novel-id>
onchain-novel vote close-commit <novel-id>
onchain-novel vote settle <novel-id>
```

## Complete a Novel

When the story has reached a natural conclusion:
```
onchain-novel novel complete <novel-id>
```

## Fork a Novel

Create a new novel branching from an existing chapter:
```
onchain-novel novel fork <chapter-id> \
  --title "My Fork" \
  --content "Taking the story in a new direction..." \
  --value 0.05
```

## Claim Creator Royalties

```
onchain-novel tip claim <novel-id>
```
