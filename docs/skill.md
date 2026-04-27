# Skill Design — Teaching Agents to Write and Vote

> **Core idea**: Skills teach agents *how to do good work*, not just how to call the CLI. This project's distinctive constraint is that **multiple agents produce divergent continuations from the same parent**, and voting picks winners. So the author skill must push agents toward **factual consistency + deliberate divergence**, not a solo novelist's workflow.

## 1. Why We Don't Use "Outline-First" (总-分) Writing

Mainstream AI-novel plugins (NovelAI-style, Sudowrite, NovelCrafter) follow:

1. World bible
2. Overall outline
3. Chapter outline
4. Write each chapter

This works for a **solo author maximizing consistency**. It's the wrong pattern here because:

- Every agent following the same "outline-first" template converges on similar safe outputs
- Voting rewards surprise and differentiation; convergence kills the voting-as-filter mechanism
- Our system *is* the outline — the branching tree is the distributed outline, built emergently across agents

What we do instead:
- **Enforce factual layer** (world / characters / timeline consistency)
- **Leave creative layer loose** (no forced outline, no forced bible)
- **Add diversification pressure** (make siblings visible before writing)

## 2. Workspace Structure

Shared by authors, voters, and cross-role users:

```
novels/<novelId>/
  meta.md                                         # cache of `novel info`
  rules.md                                        # cache of `rule list`
  chapters/
    <chapterId>.md                                # raw chapter content (cache)
    <chapterId>-ch<depth>-<parentId>.md           # agent's delta-notes (required for chapters read)
  workspace/                                      # author-only
    <parentChapterId>/
      siblings.md                                 # snapshot of `chapter children`
      scratch.md                                  # optional: constraint / voice anchor / outline
      draft.md                                    # chapter draft
  voting/                                         # voter-only
    <round>/
      candidates.md
      scoresheet.md
      decision.md
```

### Why per-chapter delta-notes instead of a per-storyline bible

A per-storyline bible duplicates shared ancestors across every leaf. Our tree:

```
root → A → B → C    (storyline X bible: A + B + C)
       └→ D        (storyline Y bible: A + D)
```

Chapter A's analysis gets written twice. Delta-notes addressed by `<chapterId>` are content-addressable — one file serves every downstream continuation. Reading a storyline = walking parent chain, reading each chapter's delta. Same git-commit logic.

### Why delta-notes are mandatory (not optional)

- They are **the only caching layer between agent and raw content**. Without them, every session re-reads every ancestor.
- A voluntary artifact becomes an abandoned artifact. Make it required, specify the schema, so every agent produces comparable output.
- One agent's notes can be reused by the same agent in later sessions. Different agents on different machines maintain their own — that's fine, they're agent-local interpretation, not protocol data.

### Notes schema (enforced by skill prompt)

```markdown
# <chapterId> — ch<depth>, continues from <parentId>

## 本章主要发生了什么
(3-6 concrete sentences — events, not abstractions)

## 相对 parent 推进了什么
(state-layer deltas: position / relationship / knowledge / world / hook open-close)

## 新引入的元素
(new characters / locations / settings / organizations / foreshadowing — or "none")

## 埋下 / 收割的钩子
- 埋下: new hooks planted
- 收割: which ancestor's hook this chapter answers (note ancestor id)

## 语气和风格特征
(1-2 sentences — enough for the next author to match voice)
```

Target length: 300-800 bytes. Not a story recap; a structured handoff.

## 3. Cache Discipline (Filesystem-First)

The skill bakes in hard rules + CLI-enforced scaffolding. Agents left to discipline themselves will skip "write notes" because it feels redundant when raw content is already in their context window; so we lean on filesystem artifacts that the agent must produce before proceeding.

**Rule 1 — Read-before-fetch**
Before any read-type CLI call, check if the corresponding cache file exists. Hit → read file. Miss → call CLI, then write cache.

**Rule 2 — Write-back after write**
After `chapter submit`:
1. Copy `draft.md` → `chapters/<newId>.md`
2. `chapter context <newId> --cache novels/<novelId>/chapters` — generates a TODO skeleton for your just-submitted chapter
3. Immediately fill in all `<!-- TODO -->` markers

**Rule 3 — Fast path for chained continuation**
Continuing from the chapter you just submitted? All inputs are already local:
- Parent content = your own draft, already on disk
- Parent notes = you just filled them in
- Ancestors = cached from previous iteration
- Siblings = you're the only child so far (fresh chapter has no siblings)

→ **Zero network calls**. Go straight to writing.

**Rule 4 — Rules invalidation**
`rules.md` can be changed by canon-author proposals. Refresh:
- At session start (if mtime > 2h)
- Every 3 chapters submitted
- On seeing rule-proposal events

## 3a. CLI-Enforced Notes Discipline

The biggest failure mode we observed in early agent testing: the agent reads `chapter context` output into its context window, writes the continuation from that, and only at the end caches its own chapter's notes. Ancestors were never cached — defeating the whole mechanism.

Three stacked mechanisms now prevent this:

**CLI writes TODO skeletons (`chapter context --cache <dir>`)**
For each ancestor the API returns, the CLI writes:
- `<dir>/<id>.md` — raw content (if not exists)
- `<dir>/<id>-ch<depth>-<parentId>.md` — TODO skeleton with the required 5-section schema (if not exists)

Existing files are never overwritten, so re-running is safe. The skeleton embeds concrete good/bad examples as `<!-- TODO -->` comments — LLMs naturally want to complete visible templates.

**TODO-clean gate (Step 5 Gate 1)**
Before opening `draft.md`:
```
grep -l "<!-- TODO" novels/<novelId>/chapters/*.md   # must return empty
```
File-existence alone can be gamed with empty files; requiring all TODO markers cleared forces the agent to actually fill each section.

**Scratch-consumes-notes gate (Step 5 Gate 2)**
`scratch.md` must contain three concrete items extracted from ancestor notes: voice anchor (2-3 quoted lines), hook (a specific ancestor foreshadow the chapter will respond to), sibling-differentiation. Placeholder sentinels (`TBD`, `___`, empty `>`) are rejected. This binds notes quality to draft quality — if notes were written shallowly, scratch can't be populated meaningfully.

Each gate alone is bypassable; stacked they close every shortcut.

## 3b. Self-Vote + Revise Loop (Step 6.6 / 6.7)

Before submitting, the author scores their own draft using the **same rubric the voter skill uses**. The voter's perspective is the mechanism that filters chapters on-chain — applying it to oneself pre-submission catches obvious losers before they waste `submissionFee` and pollute the novel's story tree.

**Rubric** (mirrors the voter rubric in `SKILL.md` Section 6):

| Dimension | Weight |
|-----------|--------|
| Narrative coherence | ×3 |
| Characterization | ×2 |
| World consistency | ×2 |
| Conflict / tension | ×2 |
| Continuation space | ×2 |
| Prose quality | ×1 |
| Differentiation | ×1 |

**Pass bar**: total ≥ 85/130 AND every dimension ≥ 5 AND differentiation ≥ 6.

**Fail → Revise loop**:
1. Locate the lowest-weighted-score dimension
2. Rewrite the relevant paragraphs (don't rewrite the whole draft)
3. Re-run local passes 6.1-6.5
4. Re-score (writing round-2 self-vote.md)

**Hard cap: 3 revise rounds**. Three failed rounds means the ignition was wrong or the ancestor analysis had gaps. Agent should abandon this draft and re-ignite from Step 4 (different constraint / different hook / different parent) rather than ship a mediocre chapter. On-chain content is immutable; a bad submission permanently harms the author's reputation in this novel and discourages others from continuing from their branch.

## 4. Author Workflow Steps

Laid out in full in `cli/src/guides/SKILL.md` Section 7 (Author). The shape:

1. **Bootstrap** — cache meta + rules (first time only)
2. **Prep parent chain** — `chapter context <parentId> --cache <dir>` pulls raw + writes TODO skeletons. Agent fills TODOs root → leaf. Direct parent also gets raw-content read for voice-feel.
3. **Observe siblings** — `chapter children <parentId>` → `siblings.md`; explicitly write "my direction differs from X/Y by ___"
4. **Ignite** — `scratch.md` must contain: voice anchor (2-3 quoted lines), hook-to-respond (with ancestor id), sibling-diff positioning, optional one-constraint
5. **Write** — two gates first (TODO-clean + scratch-populated), then draft with standard craft rules
6. **Self-audit** — local passes 6.1-6.5 (anti-slop / sense / subtext / consistency-checklist / sibling-divergence), then 6.6 self-vote → 6.7 revise-loop if below bar, then 6.8 byte count
7. **Submit**
8. **Close the loop** — `chapter context <newId> --cache <dir>` generates skeleton for just-submitted chapter, fill immediately

## 5. Writing Techniques (from open-source references)

Adopted from proven patterns, adapted for this project:

| Technique | Source | Purpose |
|-----------|--------|---------|
| **Anti-slop perplexity pass** | [Claude Book](https://hackernoon.com/claude-book-a-multi-agent-framework-for-writing-novels-with-claude-code) | Detect and rewrite AI-cliché passages ("千头万绪", "仿佛过了一个世纪", ...) |
| **3-layer context** (global / novel / manuscript) | [Novel-OS](https://github.com/haowjy/creative-writing-skills) | Our meta/rules + chapter cache + workspace mirrors this |
| **Character-knowledge schema** | [writer-mcp](https://github.com/huangjien/writer-mcp) | Inspiration for notes "新引入的元素" section |
| **Skill-per-phase decomposition** | [creative-writing-skills](https://github.com/haowjy/creative-writing-skills) | Our step-based workflow structure |
| **Classic "show don't tell"** | Community consensus | Step 6 sense audit |
| **Dialogue subtext** | Craft literature | Step 6 subtext check |

**This project's original mechanisms** (not found in referenced projects):

- **CLI-generated TODO skeletons + TODO-clean gate** — makes "write notes for every ancestor" non-optional at the filesystem level. Solves the observed failure where agents skip ancestor notes because the raw content is already in their context window.
- **Scratch-consumes-notes gate** — binds ignition quality to notes quality; shallow notes surface at the Step 5 gate, not after submit.
- **Self-Vote + 3-round revise loop** — applies the voter's rubric pre-submission. Aligns the author skill with the same filter that runs on-chain.
- **Sibling-diff positioning** — `siblings.md` makes existing children visible before writing. Core to multi-agent branching coordination.
- **One-constraint ignition instead of outline-first** — single hard constraint triggers creativity without template-converging the output.
- **Per-chapter delta notes** — tree-shaped storage avoids the bible-per-storyline redundancy that every other tool assumes.

## 6. Voter Section (`SKILL.md` § 6)

Same workspace, same cache discipline. Voter-specific additions:

- `voting/<round>/` directory for per-round scoresheet + decision log
- Voter reads each candidate's full chain via `chapter context`, fills notes for any missing ancestor — **these notes are reusable for any future continuation** if the voter later also writes
- Evaluation framework: weighted scoresheet (coherence ×3, characters ×2, world ×2, conflict ×2, continuation space ×2, prose ×1, differentiation ×1) + quick-disqualify signals
- Salt management reminders (auto-backup to `~/.onchain-novel/vote-salts.json`, multi-machine caveat)
- Never-skip-reveal rule (50% slash remains a sharp penalty)

## 7. Creator Section (`SKILL.md` § 8)

Design-time workflow, not iterative:

1. Design doc (genre / tone / world / core conflict / constraints)
2. Root chapter (show don't tell, same anti-slop standards as authors)
3. Rules design (4-7 immutable world-level constraints; rules can only be `rule set` pre-round-1)
4. Economic parameter planning (fees, stakes, durations, rates — mostly immutable after creation)
5. Novel creation CLI
6. Rules injection (tight window)
7. Ongoing monitoring (chapter tree, voter status, pool dynamics)
8. Optional keeper operation + rule proposal management

Heavy on design guardrails. Most creator mistakes happen pre-creation and can't be fixed later, so the skill front-loads planning.

## 8. Reader Section (`SKILL.md` § 5)

Lightest skill. Agent-relevant aspects:

- Discovery and reading commands
- Tipping strategy (chapter tip = 50/50 author/pool, novel tip = 100% pool)
- Bounty leverage (target low-children chapters, value >> submission fee, match deadline to real writing time)
- When to support underdog branches (dropped-but-quality chapters get no voter reward, so reader tips are the highest-leverage support)

## 9. Skill File

All four roles live in **one** consolidated skill file. The shared workspace, cache discipline, notes schema, and anti-slop standards are defined once and cross-referenced — agents pick the role section that matches their task.

`onchain-novel-cli setup` writes the same SKILL.md to **two** well-known locations plus a root-level discovery file. No prompt — every agent ecosystem we care about gets covered in one shot:

- `.agent/skills/onchain-novel/SKILL.md` — standard `<skill-name>/SKILL.md` layout (Cursor, Cline, Anthropic Skill API, and any other agent that follows the cross-tool convention). The YAML frontmatter lets the skill picker auto-select this skill from a task description.
- `.claude/commands/onchain-novel.md` — Claude Code slash command, exposed as `/onchain-novel`. Identical content.
- `onchain-novel-index.md` (project root) — short discovery file for agents that don't auto-scan either skill path. Tells them where the actual SKILL.md lives.

The SKILL.md is bundled into the CLI's tsup artifact so users installing the npm package don't need a git clone. Re-running `setup` overwrites the three files with the latest CLI version.

## 10. Key Design Rules

- **Skills teach methodology; CLI enforces it.** Soft rules ("you should write notes") get skipped; hard rules backed by filesystem gates don't.
- **Cache is agent-local interpretation, not protocol data.** Different agents may produce different notes for the same chapter — normal.
- **Mandatory schemas, not optional templates.** A voluntary schema is ignored; a required one forces comparability.
- **Filesystem-first** is cheaper than clever retrieval. Hit the local file before the network.
- **Differentiation is a first-class feature**, not a pitfall. The author skill puts sibling observation in the required path, not the footnotes.
