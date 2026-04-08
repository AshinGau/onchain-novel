# Frontend 设计

Next.js 16 + App Router。数据从 backend REST API 获取，链上写操作通过钱包（wagmi/viem）直接发交易。

## 0. 代码准则

### 0.1 模块复用

- 相同 UI 模式必须抽成组件，禁止复制粘贴
- 例如：章节卡片在列表、树、搜索结果中都用同一个 `<ChapterCard>`
- 按钮、输入框、Modal、Toast 等基础元素统一封装在 `components/ui/` 下

### 0.2 配色规范

采用 CSS 变量定义完整的色彩系统，不在组件中硬编码颜色值：

```css
:root {
  /* 主色 */
  --color-primary: #6366f1;       /* indigo-500 */
  --color-primary-hover: #4f46e5; /* indigo-600 */

  /* 语义色 */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;

  /* 中性色 */
  --color-bg: #ffffff;
  --color-bg-secondary: #f9fafb;
  --color-bg-tertiary: #f3f4f6;
  --color-text: #111827;
  --color-text-secondary: #6b7280;
  --color-text-muted: #9ca3af;
  --color-border: #e5e7eb;

  /* 世界线专用色（区分 N 条世界线） */
  --color-worldline-1: #6366f1;
  --color-worldline-2: #8b5cf6;
  --color-worldline-3: #ec4899;
  --color-worldline-4: #f59e0b;
  --color-worldline-5: #10b981;
}

[data-theme="dark"] {
  --color-bg: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-bg-tertiary: #334155;
  --color-text: #f1f5f9;
  --color-text-secondary: #94a3b8;
  --color-text-muted: #64748b;
  --color-border: #334155;
}
```

所有组件只引用 `var(--color-xxx)`，不直接写 `#xxx` 或 `rgb()`。

### 0.3 CSS 样式规范

**禁止在 HTML 元素上堆砌内联样式或大量 utility class。** 采用语义化 CSS class：

```css
/* globals.css — 预定义的语义 class */

/* 布局 */
.container { max-width: 1200px; margin: 0 auto; padding: 0 1rem; }
.stack { display: flex; flex-direction: column; gap: 1rem; }
.row { display: flex; align-items: center; gap: 0.5rem; }
.grid-cols-n { display: grid; grid-template-columns: repeat(var(--cols, 3), 1fr); gap: 1.5rem; }

/* 排版 */
.text-heading { font-size: 1.5rem; font-weight: 700; color: var(--color-text); }
.text-subheading { font-size: 1.125rem; font-weight: 600; color: var(--color-text); }
.text-body { font-size: 1rem; line-height: 1.75; color: var(--color-text); }
.text-caption { font-size: 0.875rem; color: var(--color-text-secondary); }
.text-muted { color: var(--color-text-muted); }

/* 卡片 */
.card { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 0.75rem; padding: 1.25rem; }
.card-hover { transition: box-shadow 0.2s; }
.card-hover:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }

/* 按钮 */
.btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: 500; cursor: pointer; transition: background 0.15s; }
.btn-primary { background: var(--color-primary); color: white; }
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-secondary { background: var(--color-bg-tertiary); color: var(--color-text); }
.btn-ghost { background: transparent; color: var(--color-text-secondary); }
.btn-danger { background: var(--color-danger); color: white; }

/* 章节内容排版（阅读页） */
.prose { max-width: 680px; margin: 0 auto; font-family: Georgia, 'Noto Serif', serif; line-height: 1.9; }
.prose p { margin-bottom: 1.25em; }

/* 徽章 */
.badge { display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; }
.badge-worldline { background: var(--color-primary); color: white; }
.badge-depth { background: var(--color-bg-tertiary); color: var(--color-text-secondary); }
```

组件中这样使用：
```tsx
// 好
<div className="card card-hover">
  <h2 className="text-heading">{title}</h2>
  <p className="text-caption">{author}</p>
</div>

// 坏 — 禁止
<div style={{background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 20}}>
```

### 0.4 主题切换

- `data-theme` 属性挂在 `<html>` 上
- 所有颜色通过 CSS 变量引用，切换主题只需改 `data-theme="dark"`
- 一键切换：`document.documentElement.dataset.theme = theme`
- 持久化到 localStorage，页面加载时读取
- 默认跟随系统 `prefers-color-scheme`

### 0.5 响应式布局

断点定义：
```css
/* 移动端优先 */
/* sm: 640px  — 平板竖屏 */
/* md: 768px  — 平板横屏 */
/* lg: 1024px — 桌面 */
/* xl: 1280px — 大屏 */
```

关键适配：
- **小说主页 N 列**：`lg+` 显示 N 列并排；`md` 显示 2 列；`sm-` 显示 tab 切换单列
- **阅读页**：所有尺寸居中单列，`max-width: 680px`
- **故事树页**：`sm-` 提示"建议在桌面端查看"，仍可缩放查看
- **导航栏**：`sm-` 折叠为汉堡菜单

### 0.6 不参考 V1 代码

V1 前端代码风格不统一，不作为参考。从零开始，遵循上述规范。

---

## 1. 页面结构

```
/novels                         → 小说列表
/novels/[id]                    → 小说主页（N 列链式展示 + 小说信息）
/novels/[id]/read/[leafId]      → 阅读页（root → leaf 翻页阅读）
/novels/[id]/chapter/[chapterId]→ 章节页（单章详情 + 导航）
/novels/[id]/tree               → 故事树页（BFS 树形可视化）
```

## 2. 小说列表 `/novels`

- 分页列表，每页 10-20 条
- 排序：最新 / 最活跃（章节数）/ 奖池最大
- 搜索：按标题
- 每个卡片：标题、creator、章节数、世界线数、奖池余额、当前 round/phase
- 点击 → 进入小说主页

## 3. 小说主页 `/novels/[id]`

### 3.1 顶部信息栏

```
Novel Title
Creator: 0x1234...  |  Round 3 · Idle  |  Pool: 1.5 ETH  |  N=3 世界线
[续写] [投票] [打赏] [规则] [Fork]
```

- 投票按钮：仅在 Committing/Revealing 阶段显示
- 续写按钮：始终可用（链接到编辑器，选择 parent 后提交）
- 前端不展示 Nominating 相关操作（留给 CLI/MCP 用户）

### 3.2 N 列链式展示

每条世界线一列，展示从 root 到该世界线最深后代的链：

```
世界线 1               世界线 2               世界线 3
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Ch.1 (root) │     │ Ch.1 (root) │     │ Ch.1 (root) │
│ by Creator  │     │ by Creator  │     │ by Creator  │
│             │     │             │     │             │
│ ··· 5 章 ···│     │ ··· 5 章 ···│     │ ··· 3 章 ···│
│             │     │             │     │             │
│ ★ Ch.12     │     │ ★ Ch.11     │     │ ★ Ch.8      │
│ (世界线)    │     │ (世界线)    │     │ (世界线)    │
│             │     │             │     │             │
│ ··· 3 章 ···│     │ ··· 2 章 ···│     │ ··· 4 章 ···│
│             │     │             │     │             │
│ 🍃 Ch.18    │     │ 🍃 Ch.15    │     │ 🍃 Ch.14    │
│             │     │             │     │             │
│ [阅读故事线] │     │ [阅读故事线] │     │ [阅读故事线] │
└─────────────┘     └─────────────┘     └─────────────┘
```

**展示逻辑**：
1. 从 backend `GET /api/novels/:id/worldlines` 获取 N 条世界线
2. 从 backend `GET /api/novels/:id/tree` 获取章节树
3. 对每条世界线，从 worldLineAncestor 做 DFS 找最深后代（leaf）
4. 展示链：root → `···X章···` → worldLineAncestor → `···X章···` → leaf

**`···X 章···` 折叠区**：
- 默认折叠，显示中间章节数量
- 点击展开为简略列表：每章一行（chapterId · author · 首句预览）
- 展开后的每章可点击进入章节页

**移动端**：N 列改为 tab 切换，一次显示一列。

### 3.3 其他分支

worldLineAncestor 的后代中，除了最长链外的其他分支，以同样的折叠格式展示在最长链下方：

```
其他分支（3 条）  ▼ 展开
├─ Ch.12 → ··· 2 章 ··· → Ch.16  [阅读]
├─ Ch.12 → Ch.13                  [阅读]
└─ Ch.12 → ··· 1 章 ··· → Ch.17  [阅读]
```

## 4. 阅读页 `/novels/[id]/read/[leafId]`

从 root 到 leafId 的完整故事线，翻页阅读。

### 4.1 数据获取

`GET /api/chapters/:leafId/context` → 获取祖先链（root → ... → leaf），每章包含 content_text。

### 4.2 交互

- 翻页：上一章 / 下一章（键盘左右箭头 or 滑动）
- 顶部：当前章节 / 总章节数 进度条
- 底部：到达最后一章后显示 [续写此故事线] 按钮
- 每章显示：作者、depth、内容全文

### 4.3 样式

- 居中排版，最大宽度 680px
- 正文用衬线字体（如 Georgia / Noto Serif）
- 暗色/亮色模式切换

## 5. 章节页 `/novels/[id]/chapter/[chapterId]`

单章详情 + 导航。

### 5.1 顶部导航按钮

```
[← Previous]  [Continue →]  [Story Tree 🌳]
```

- **Previous**：跳转到 parentId 的章节页
- **Continue**：展开显示 descendants 列表（子章节），每个可点击
- **Story Tree**：跳转到故事树页

### 5.2 章节内容

- 作者、depth、提交时间
- 完整 content_text
- Tips 数量、Bounty 数量
- [打赏此章] [对此章发起续写悬赏] 按钮

### 5.3 续写入口

- [续写此章] 按钮 → 弹出编辑器
- 编辑器：文本输入框 + 字数统计（min/max 提示）
- 提交：连接钱包 → submitChapter(novelId, chapterId, content) + submissionFee

### 5.4 投票入口

- 如果当前章节是本轮候选，显示 [投票给此章] 按钮
- 投票流程：输入 salt → commit（质押 voteStake）→ 等待 reveal 阶段 → reveal
- salt 存储在 localStorage（与 V1 相同的 vote-storage 模式）

## 6. 故事树页 `/novels/[id]/tree`

真正的树形可视化，BFS 渲染。

### 6.1 技术选型

使用 **react-d3-tree**：
- BFS 懒加载：初始加载 `maxLoadDepth`（如 5）层
- 点击叶节点加载更多后代
- 自定义节点样式
- 缩放/平移
- 折叠/展开子树

### 6.2 节点样式

```
┌──────────────┐
│ Ch.12        │
│ by Alice     │
│ depth: 8     │
│ "风暴来临..." │  ← 首句预览（截断 30 字）
│              │
│ ★ 世界线      │  ← 如果是 worldLineAncestor
│ 🏆 2 bounties │
└──────────────┘
```

世界线节点用高亮边框标识。

### 6.3 懒加载

```
初始渲染: root → depth 5
          └── 点击 [加载更多] → 加载 depth 6-10
                              └── 点击 [加载更多] → ...
```

API：`GET /api/novels/:id/tree` 返回所有章节，前端按 depth 分批渲染。或者后端加 `maxDepth` 参数支持分页加载。

### 6.4 交互

- 点击节点 → 跳转到章节页
- 双击节点 → 展开/折叠子树
- 右键 → 阅读此故事线 / 续写 / 投票

## 7. 钱包集成

- wagmi v2 + viem
- 连接钱包按钮在顶部导航栏
- 写操作（续写、投票、打赏、悬赏）需要钱包连接
- 读操作不需要钱包
- 交易确认后刷新页面数据

## 8. 投票流程（前端）

前端只处理 Committing 和 Revealing 阶段，不处理 Nominating。

### Committing 阶段

1. 用户在章节页或小说主页看到候选列表
2. 选择要投票的候选章节
3. 输入 salt（或自动生成随机 salt）
4. 计算 commitHash = keccak256(encodePacked(uint64(candidateId), bytes32(salt)))
5. 发送 commitVote(novelId, commitHash) + voteStake
6. salt + candidateId 存入 localStorage

### Revealing 阶段

1. 从 localStorage 读取 salt + candidateId
2. 发送 revealVote(novelId, candidateId, salt)
3. 显示"已揭露，等待结算"

## 9. 数据流

| 页面 | 数据源 |
|------|--------|
| 小说列表 | `GET /api/novels` |
| 小说主页 | `GET /api/novels/:id` + `/worldlines` + `/tree` |
| 阅读页 | `GET /api/chapters/:id/context` |
| 章节页 | `GET /api/chapters/:id` + `/children` + `/bounties` + `/tips` |
| 故事树 | `GET /api/novels/:id/tree` |
| 投票候选 | `GET /api/novels/:id/rounds/:round` |
| 用户信息 | `GET /api/users/:address/chapters` + `/votes` + `/rewards` |

## 10. 不实现的功能

- Nominating 相关 UI（留给 CLI/MCP）
- 评论系统（backend 保留 API，前端暂不做）
- 用户个人主页（暂不需要）
- Fork 创建 UI（用 CLI）
- 规则管理 UI（用 CLI）
- Novel 完结 UI（用 CLI）

## 11. 组件结构

```
web/frontend/src/
  app/
    layout.tsx                    # 全局 layout（导航栏、钱包连接）
    page.tsx                      # 首页 → redirect /novels
    novels/
      page.tsx                    # 小说列表
      [id]/
        page.tsx                  # 小说主页（N 列链式展示）
        read/[leafId]/page.tsx    # 阅读页
        chapter/[chapterId]/page.tsx # 章节页
        tree/page.tsx             # 故事树页
  components/
    novel-card.tsx                # 小说列表卡片
    chain-column.tsx              # 世界线列（一列链式展示）
    chapter-card.tsx              # 章节卡片（小型）
    chapter-reader.tsx            # 阅读器（翻页）
    chapter-editor.tsx            # 续写编辑器
    vote-panel.tsx                # 投票面板（commit/reveal）
    story-tree.tsx                # react-d3-tree 封装
    wallet-button.tsx             # 钱包连接按钮
  lib/
    api.ts                        # backend API 客户端
    contracts.ts                  # 合约交互（wagmi hooks）
    vote-storage.ts               # localStorage salt 存储
    config.ts                     # 合约地址、链配置
  hooks/
    use-novel.ts                  # 小说数据 hook
    use-chapter.ts                # 章节数据 hook
    use-tx-action.ts              # 交易发送 + 等待确认
```
