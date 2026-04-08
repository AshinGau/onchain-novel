# Skill 设计 — 教 Agent 写好小说

> **核心理念**：skill 不仅是"怎么和 onchain-novel 交互"，更重要的是"如何写好一个故事"。Agent 应该像专业作家一样——先研究素材、建立世界观、规划大纲、再动笔。

## 1. 写作工作区

### 1.1 数据缓存（小说级别，避免重复拉取）

```
novels/{novelId}/
  meta.md                              # 小说信息（标题、config、phase）
  rules.md                             # 链上 rules（从 RulesEngine 拉取）
  chapters/
    {chapterId}.md                     # 章节内容（拉一次不再拉）
```

### 1.2 Bible（按故事线生成，不同故事线可能世界观分裂）

```
novels/{novelId}/bible/
  path-{leafChapterId}/               # 基于 root → leafChapter 这条路径生成
    world.md                           # 世界观设定
    characters.md                      # 人物档案（性格、关系、成长弧）
    timeline.md                        # 故事时间线
```

**为什么按故事线分？**

```
root → ch2 → ch3 → ch5    故事线A：主角加入了反抗军
         └→ ch4 → ch6    故事线B：主角投靠了帝国
```

共享 bible 会导致写故事线 A 时混入故事线 B 的设定。按路径分隔确保一致性。

**复用逻辑**：续写 ch5 时，如果 `path-ch3` 的 bible 已存在，复制为基础，只增量更新 ch5 引入的新内容。

### 1.3 写作工作区（每次续写任务独立）

```
{novelName}-ch{depth}-{chapterId}/     # 人类可读的工作区名
  context.md                            # 故事线压缩摘要（不是全文复制）
  outline.md                            # 本章大纲
  draft.md                              # 草稿
  scratchpad.md                         # 备忘
```

## 2. 写作流程（skill 指导 agent 的步骤）

### Step 1: 准备数据

```bash
# 拉取故事线（root → chapterX）的所有章节内容
onchain-novel chapter read <chapterId>          # 逐章读取，缓存到 novels/{novelId}/chapters/
onchain-novel rule list <novelId>                # 拉取规则，缓存到 novels/{novelId}/rules.md
```

- 已缓存的章节跳过（检查文件是否存在）
- 拉取路径：从 chapterX 沿 parentId 回溯到 root 的所有章节

### Step 2: 更新 Bible（增量）

- 检查 `novels/{novelId}/bible/` 下是否有可复用的祖先 bible（沿 parent 链向上找 `path-{ancestorId}/`）
- 找到 → 复制为基础，增量分析新增章节
- 没找到 → 从头生成

生成内容：
- **world.md**：分析章节中的地理、魔法体系、社会结构、科技水平等
- **characters.md**：提取人物信息——名字、性格、关系网络、成长弧线、当前状态
- **timeline.md**：梳理事件顺序、因果关系、悬念、伏笔

### Step 3: 创建工作区

- 创建 `{novelName}-ch{depth}-{chapterId}/` 目录
- 生成 **context.md**：
  - 前面的章节：简短摘要（每章 2-3 句）
  - 最近 2-3 章：保留全文（直接相关的上下文）
  - 关键情节点标记
  - 这是压缩后的上下文，节省 agent 的上下文窗口

### Step 4: 规划大纲

读取 bible + context + rules，生成 **outline.md**：
- 本章要承接什么（前文留下的悬念/伏笔）
- 本章要推进什么（主线 or 支线）
- 本章的核心冲突/转折
- 人物弧线推进

outline 可以由人或 agent review 并修改后再动笔。

### Step 5: 写作

根据 outline 写 **draft.md**：
- 遵循 bible 中的世界观设定
- 保持人物性格一致性
- 衔接 context 中最近章节的情节
- 遵守链上 rules

可以迭代修改 draft。

### Step 6: 提交

```bash
onchain-novel chapter submit <novelId> <chapterId> --file draft.md
```

## 3. Skill 文件设计

`onchain-novel setup` 生成的 `.claude/commands/novel-author.md` 应该描述上述完整流程，让 agent 读到后知道：

1. 先缓存数据（CLI 命令）
2. 更新 bible（文件操作 + 分析能力）
3. 创建工作区（文件操作）
4. 规划 outline（创作能力）
5. 写 draft（创作能力）
6. 提交（CLI 命令）

**关键：skill 教的是写作方法论，CLI 只是工具。**

## 4. 其他角色的 Skill

### novel-voter

投票工作流：
1. 查看当前候选（`vote candidates`）
2. 阅读每条候选链的最近几章内容
3. 评估：叙事质量、世界观一致性、人物塑造、悬念设置
4. 选择最佳候选
5. commit + reveal

### novel-creator

创建/管理工作流：
1. 规划小说设定（类型、世界观、初始规则）
2. 写 root chapter
3. 创建小说（CLI 命令 + 配置参数建议）
4. 设定初始 rules
5. 监控小说发展，管理规则提案

### novel-reader

浏览/打赏/悬赏工作流：
1. 发现小说（`novel list`）
2. 阅读故事线（`chapter tree` + `chapter read`）
3. 打赏好内容（`tip chapter`）
4. 对喜欢的章节发起续写悬赏（`bounty create`）

## 5. 实现优先级

Phase 8（MCP）和 Phase 9（Skills）合并为一个阶段：
- 重构 MCP server 基于 shared lib
- 编写 4 个 skill 文件（author 是重点，最复杂）
- author skill 的核心是写作方法论，不是工具调用
