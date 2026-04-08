# Reader Workflow

Browse, read, tip, and incentivize stories.

## Browse Novels

```
onchain-novel novel list
onchain-novel novel list --sort hot --limit 5
onchain-novel novel list --filter active --search "sci-fi"
```

## Read a Novel

```
onchain-novel novel info <novel-id>
onchain-novel chapter tree <novel-id>
onchain-novel chapter read <chapter-id>
```

Follow the world line path for the canonical story, or explore branches.

## Tip Authors

Tip an entire novel (goes to prize pool):
```
onchain-novel tip novel <novel-id> --value 0.01
```

Tip a specific chapter (50% to author, 50% to prize pool):
```
onchain-novel tip chapter <chapter-id> --value 0.01
```

## Create Bounties

Incentivize continuations of a chapter you want to see more of:
```
onchain-novel bounty create <chapter-id> --value 0.1 --deadline 7d
```

- 20% goes to the prize pool immediately.
- 80% is locked and split among authors who submit continuations before the deadline.
- If no one continues, you can refund:
  ```
  onchain-novel bounty refund <bounty-id>
  ```

## Check Bounty Status

```
onchain-novel bounty info <bounty-id>
```
