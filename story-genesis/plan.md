# Story Genesis Plan

## Overview

Generate 30 genesis novels for the onchain novel protocol. Each novel contains 3 genesis chapters that serve as the foundation for collaborative continuation on-chain.

## Requirements

### Content Specifications
- **Total novels**: 30
- **Chapters per novel**: 3
- **Chapter length**: 2,000 ~ 10,000 characters per chapter
- **File format**: `.txt` (plain text, UTF-8)
- **Languages**: Chinese (18 novels) / English (12 novels)

### Quality Control Process

Every novel MUST go through at least **3 rounds** of the following cycle:

```
Round N:
  1. Create  — Write/revise the full 3-chapter content
  2. Score   — Evaluate against scoring criteria (see below)
  3. Revise  — Address all issues identified in scoring
```

#### Scoring Criteria (each item scored 1-10)

| Dimension | Description |
|-----------|-------------|
| Hook | Does the opening grab the reader within the first 200 characters? |
| Character | Are characters distinct, memorable, and motivated? |
| World | Is the setting vivid and immersive without info-dumping? |
| Pacing | Does each chapter end with a compelling reason to continue? |
| Voice | Is the narrative voice consistent and suited to the genre? |
| Originality | Does the story avoid cliches or subvert them meaningfully? |
| Collaboration Potential | Does the genesis leave enough open threads for co-authors? |
| Language Quality | Is the prose polished, with no grammar/logic errors? |

**Pass threshold**: Every dimension >= 7, overall average >= 8. If not met, another round is required.

### File Naming Convention

```
story-genesis/
├── plan.md
├── 01-九龙城寨消失的房间/
│   ├── chapter-1.txt
│   ├── chapter-2.txt
│   ├── chapter-3.txt
│   └── review.md          # Scoring records for all rounds
├── 02-the-silk-road-murders/
│   ├── chapter-1.txt
│   ├── chapter-2.txt
│   ├── chapter-3.txt
│   └── review.md
├── ...
└── 30-我在台北当天师/
    ├── chapter-1.txt
    ├── chapter-2.txt
    ├── chapter-3.txt
    └── review.md
```

---

## Novel List

### Mystery / Suspense (5 novels)

| # | Title | Setting | Language | Chapter Structure |
|---|-------|---------|----------|-------------------|
| 1 | 九龙城寨消失的房间 | Hong Kong | CN | ①密室发现/诡异现场 ②受害者生前72小时 ③第二具尸体出现 |
| 2 | The Silk Road Murders | Southeast Asia | EN | ①Body in the Mekong ②The investigator's secret ③Everyone has an alibi |
| 3 | 台北捷运末班车 | Taiwan | CN | ①车厢里多了一个人 ②监控录像的矛盾 ③乘客们的谎言 |
| 4 | The Vienna Cipher | Europe | EN | ①Cryptographer vanishes ②The coded manuscript ③Decryption points to the next victim |
| 5 | 曼谷雨季失踪案 | Southeast Asia | CN | ①游客失踪 ②夜市摊主的证词 ③照片里的第三个人 |

**Creative Approach**:
- References: Keigo Higashino (trick design), Agatha Christie (closed-room logic), Zi Jin Chen (social-realist mystery)
- Techniques: Unreliable narrator, information asymmetry, narrative tricks
- Genesis strategy: NO spoilers. Focus on suspense, plant true and false clues, end every chapter on a cliffhanger
- Architecture references: *White Night* (dual timeline), *The Devotion of Suspect X* (reversal design), *Bad Kids* (multi-POV)

### Revenge (4 novels)

| # | Title | Setting | Language | Chapter Structure |
|---|-------|---------|----------|-------------------|
| 6 | 旺角复仇者 | Hong Kong | CN | ①出狱/街景描写 ②仇人名单与计划 ③第一个目标接近 |
| 7 | Blood Debt of Saigon | Southeast Asia | EN | ①War orphan's childhood ②Discovering the truth about father's death ③Setting out on the path of vengeance |
| 8 | 眷村的秘密 | Taiwan | CN | ①老兵临终遗言 ②1949年的背叛 ③孙辈追查真相 |
| 9 | The Corsican Vendetta | Europe | EN | ①Family funeral / oath ②The enemy's empire ③First direct confrontation |

**Creative Approach**:
- References: *The Count of Monte Cristo* (systematic revenge), *Oldboy* (extreme revenge), Scorsese's crime films
- Techniques: Alternating flashback/present, layered revelation of hatred, moral gray zones
- Genesis strategy: Ch1 establishes emotional justification; Ch2 shows the enemy's power and the difficulty of revenge; Ch3 the first move — reveals protagonist's resolve and methods
- Architecture references: *Monte Cristo* (planned revenge), *Kill Bill* (list structure), *Sympathy for Lady Vengeance* (cold revenge)

### Romance (3 novels)

| # | Title | Setting | Language | Chapter Structure |
|---|-------|---------|----------|-------------------|
| 10 | 维多利亚港的月光 | Hong Kong | CN | ①偶遇/城市孤独感 ②误解与靠近 ③一个改变一切的夜晚 |
| 11 | Love in Chiang Mai | Southeast Asia | EN | ①Meeting on the road ②Cultural clash and attraction ③The countdown to departure |
| 12 | 巴黎左岸的雨 | Europe | CN | ①留学生的孤独 ②咖啡馆的常客 ③语言之外的理解 |

**Creative Approach**:
- References: Eileen Chang (Chinese urban love), Murakami (loneliness), *Before Sunrise* trilogy (travel romance)
- Techniques: Nuanced psychological portrayal, environment mirroring emotion, dialogue-driven plot
- Genesis strategy: Ch1 uses city atmosphere and a chance encounter to build chemistry; Ch2 introduces misunderstanding or obstacle; Ch3 a pivotal moment that changes the relationship
- Key rule: Love needs an element of "impossibility" (cultural gap, identity gap, time limit) to create tension

### Campus (3 novels)

| # | Title | Setting | Language | Chapter Structure |
|---|-------|---------|----------|-------------------|
| 13 | 那些年，在建中的日子 | Taiwan | CN | ①开学典礼/人物群像 ②社团招新/小团体形成 ③第一次期中考前的秘密 |
| 14 | Freshman Year at UCLA | USA | EN | ①Moving into the dorm ②Parties and pressure ③Roommate's secret exposed |
| 15 | 新加坡国际学校 | Southeast Asia | CN | ①转学生视角/文化冲击 ②阶层与种族暗流 ③一场改变格局的比赛 |

**Creative Approach**:
- References: Giddens (Taiwanese campus), *Dead Poets Society* (American campus), Japanese school anime/manga
- Techniques: Ensemble cast, coming-of-age arcs, friendship and betrayal
- Genesis strategy: Ch1 character gallery (each with distinctive traits); Ch2 relationship networks form; Ch3 first major conflict ignites
- Key rule: Characters need specificity — catchphrases, habits, quirks — not abstract descriptions

### Horror (3 novels)

| # | Title | Setting | Language | Chapter Structure |
|---|-------|---------|----------|-------------------|
| 16 | 香港旧楼里的声音 | Hong Kong | CN | ①搬入唐楼/异响 ②邻居的警告 ③墙壁里的东西 |
| 17 | The Plantation House | Southeast Asia | EN | ①Inheriting the estate ②The servants' taboos ③The first night |
| 18 | 阿里山的雾 | Taiwan | CN | ①登山队迷路 ②废弃神社 ③队员一个个失踪 |

**Creative Approach**:
- References: Stephen King (psychological horror), Japanese kaidan (atmospheric horror), Thai horror films (folk horror)
- Techniques: Gradual dread, sensory writing (especially sound and touch), the uncanny in the mundane, suggestion over showing
- Genesis strategy: Ch1 establishes "safe" normalcy with only tiny wrongness; Ch2 wrongness intensifies but remains deniable; Ch3 normalcy shatters completely
- Key rule: Horror comes from the unknown — genesis chapters must exercise restraint, never reveal the source too early

### Wuxia / Martial Arts (3 novels)

| # | Title | Setting | Language | Chapter Structure |
|---|-------|---------|----------|-------------------|
| 19 | 蜀山异闻录 | Ancient China | CN | ①江湖格局/门派介绍 ②少年入门拜师 ③初显天赋/暗流涌动 |
| 20 | 南洋刀客 | Southeast Asia | CN | ①华人武师闯南洋 ②码头势力暗斗 ③比武立威 |
| 21 | 江湖夜雨十年灯 | Ancient China | CN | ①退隐剑客/回忆 ②旧敌找上门 ③不得不重出江湖 |

**Creative Approach**:
- References: Jin Yong (grand jianghu), Gu Long (atmosphere and dialogue), Wen Rui'an (fast-paced)
- Techniques: Cinematic martial arts descriptions, jianghu customs and social dynamics, morally ambiguous codes of honor
- Genesis strategy: Ch1 establishes the jianghu landscape (factions, martial arts schools); Ch2 focuses on the protagonist's origin; Ch3 first significant fight or event
- Key rule: "Xia" (chivalry) matters more than "wu" (martial arts) — actions must be driven by jianghu ethics

### Fantasy (3 novels)

| # | Title | Setting | Language | Chapter Structure |
|---|-------|---------|----------|-------------------|
| 22 | The Last Dragonborn | Europe | EN | ①World and magic system ②The chosen youth ③First awakening |
| 23 | 南洋降头师 | Southeast Asia | CN | ①降头术的世界/禁忌 ②师徒传承 ③第一次对决 |
| 24 | The Nexus of Manhattan | USA | EN | ①The magical underworld of NYC ②An ordinary person pulled in ③The rift between worlds |

**Creative Approach**:
- References: *Harry Potter* (hidden world), *Lord of the Rings* (epic structure), Southeast Asian mythology
- Techniques: Three pillars of worldbuilding (magic system/rules, power structure, history/mythology), ordinary-person POV as entry point
- Genesis strategy: Ch1 reveals the world through action, not exposition (show don't tell); Ch2 protagonist gets drawn in; Ch3 first encounter with magic — awe and danger
- Key rule: Magic must have costs and rules, never omnipotent. Worldbuilding unfolds gradually across three chapters

### Erotic Drama (3 novels)

| # | Title | Setting | Language | Chapter Structure |
|---|-------|---------|----------|-------------------|
| 25 | 半岛酒店的秘密房客 | Hong Kong | CN | ①奢华表象下的欲望 ②禁忌关系的开始 ③权力与情欲的交织 |
| 26 | Nights in Barcelona | Europe | EN | ①Artist meets muse ②Creation and passion ③A dangerous triangle |
| 27 | 曼谷浮生录 | Southeast Asia | CN | ①异乡人的沉沦 ②地下世界的规则 ③情感与欲望的撕裂 |

**Creative Approach**:
- References: Junichi Watanabe (erotic literature), Henry Miller (raw yet literary), Eileen Chang's *Lust, Caution* (desire as weapon)
- Techniques: Erotic scenes serve plot and character development, power dynamics as subtext, literary body writing
- Genesis strategy: Ch1 establishes characters' desires and dilemmas (no rush to explicit scenes); Ch2 the relationship forms and taboos are crossed; Ch3 consequences of desire begin to surface
- Key rule: Every erotic scene must serve a narrative purpose. Use suggestion, restraint, and metaphor to elevate literary quality

### Power Fantasy (3 novels)

| # | Title | Setting | Language | Chapter Structure |
|---|-------|---------|----------|-------------------|
| 28 | 重生之港岛大亨 | Hong Kong | CN | ①重生回1997 ②第一桶金/降维打击 ③商业帝国雏形 |
| 29 | System Awakened | USA | EN | ①Gaining the system / rules intro ②First level-up ③Crushing the first opponent / rising fame |
| 30 | 我在台北当天师 | Taiwan | CN | ①觉醒灵眼 ②第一个委托 ③实力碾压/口碑爆发 |

**Creative Approach**:
- References: Classic web novels (rebirth/system/cheat), Japanese isekai, American superhero origins
- Techniques: Fast pacing, high-density power moments, face-slapping loop (flex → mockery → counter-kill → shock), clear progression system
- Genesis strategy: Ch1 protagonist gains the cheat (rebirth/awakening/system); Ch2 first use of power, testing the waters; Ch3 crushes first opponent, establishes the "cool" rhythm
- Key rule: Power moments must be dense and rhythmic, progression system must be clear enough for co-authors to continue

---

## Distribution Summary

### By Setting

| Setting | Count | Novel Numbers |
|---------|-------|---------------|
| Hong Kong | 6 | #1, #6, #10, #16, #25, #28 |
| Southeast Asia | 7 | #2, #5, #7, #11, #15, #17, #20, #23, #27 |
| Taiwan | 5 | #3, #8, #13, #18, #30 |
| Europe | 5 | #4, #9, #12, #22, #26 |
| USA | 3 | #14, #24, #29 |
| Ancient China | 2 | #19, #21 |

### By Language

| Language | Count | Novel Numbers |
|----------|-------|---------------|
| Chinese | 18 | #1, 3, 5, 6, 8, 10, 12, 13, 15, 16, 18, 19, 20, 21, 23, 25, 27, 28, 30 |
| English | 12 | #2, 4, 7, 9, 11, 14, 17, 22, 24, 26, 29 |

### By Genre

| Genre | Count | Novel Numbers |
|-------|-------|---------------|
| Mystery / Suspense | 5 | #1-5 |
| Revenge | 4 | #6-9 |
| Romance | 3 | #10-12 |
| Campus | 3 | #13-15 |
| Horror | 3 | #16-18 |
| Wuxia | 3 | #19-21 |
| Fantasy | 3 | #22-24 |
| Erotic Drama | 3 | #25-27 |
| Power Fantasy | 3 | #28-30 |

---

## Execution Workflow

For each novel (#1 through #30):

```
Step 1: CREATE
  - Write chapter-1.txt, chapter-2.txt, chapter-3.txt
  - Each chapter: 2,000 ~ 10,000 characters
  - Follow the genre-specific creative approach above

Step 2: SCORE (Round 1)
  - Evaluate all 8 dimensions (1-10 each)
  - Record scores and detailed feedback in review.md

Step 3: REVISE
  - Address every issue from scoring
  - Rewrite weak sections, strengthen hooks, fix pacing

Step 4: SCORE (Round 2)
  - Re-evaluate all dimensions
  - Compare with Round 1 scores

Step 5: REVISE
  - Fine-tune based on Round 2 feedback
  - Polish prose, tighten dialogue, sharpen cliffhangers

Step 6: SCORE (Round 3)
  - Final evaluation
  - All dimensions must be >= 7, average must be >= 8
  - If not met, continue additional rounds until threshold is reached

Step 7: FINALIZE
  - Lock chapter files
  - Complete review.md with all round records
```

### review.md Template

```markdown
# Review: [Novel Title]

## Round 1
| Dimension | Score | Notes |
|-----------|-------|-------|
| Hook | /10 | |
| Character | /10 | |
| World | /10 | |
| Pacing | /10 | |
| Voice | /10 | |
| Originality | /10 | |
| Collaboration Potential | /10 | |
| Language Quality | /10 | |
| **Average** | **/10** | |

### Issues to Address
- ...

## Round 2
...

## Round 3 (Final)
...
```
