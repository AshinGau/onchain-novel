# Author Workflow

Write chapters and earn rewards when your writing is voted onto the world line.

## Quick Start

1. Browse novels to find one to contribute to:
   ```
   onchain-novel novel list --filter active
   onchain-novel novel info <novel-id>
   ```

2. Read the current story tree and world lines:
   ```
   onchain-novel chapter tree <novel-id>
   ```

3. Read a specific chapter for context:
   ```
   onchain-novel chapter read <chapter-id>
   ```

4. Submit a chapter continuing from any existing chapter:
   ```
   onchain-novel chapter submit <novel-id> <parent-id> --content "Your chapter text..."
   ```
   This costs the novel's submission fee (paid in ETH).

5. Check if your chapter is on a world line after voting:
   ```
   onchain-novel chapter read <your-chapter-id>
   ```

6. Claim your rewards:
   ```
   onchain-novel tip claim <novel-id>
   ```

## Tips

- You can submit chapters at any time, even during voting rounds.
- Any chapter can be a parent — not just world line chapters.
- Longer, higher-quality chapters attract more votes.
- Check bounties for chapters readers want continued:
  ```
  onchain-novel novel info <novel-id>
  ```
- After submitting to a bounty target chapter, claim the bounty after deadline:
  ```
  onchain-novel bounty claim <bounty-id>
  ```
