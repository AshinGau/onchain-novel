## Content Storage Refactor Plan ✅ Completed

### 动机

当前方案（Arweave 前端直传）存在两个根本性 UX 问题：
1. **测试环境不可用** — Arweave/Irys 需要真实 ETH，Anvil 测试网无法使用
2. **跨链操作** — 上线后部署在 L2，但 Arweave 上传需要 mainnet ETH，用户需要在两条链间切换

### 新方案：可插拔 ContentLocation

小说创建时选择内容存储方式，三种模式统一抽象为 `ContentLocation`：

```
Onchain   — 内容直接通过 calldata 传入合约, emit event 存储, 后端从 event 提取
External  — 内容存在 IPFS/Arweave, 链上只存 contentHash, 后端从 contentBaseUrl+hash 拉取
HTTP      — 内容存在 HTTP URL (S3/R2/CDN), 链上存 contentHash, 后端从 URL 拉取
```

**推荐 Onchain 模式**：在便宜的 L2 上 (Base/Arbitrum), 10KB calldata ≈ $0.01-0.05, 比 Arweave 更便宜, 且零外部依赖。

封面图简化为 **URL 字符串输入**（可为空），不走任何上传流程。

---

### 1. 合约改动 (DataTypes + NovelCore + INovelCore)

#### 1.1 DataTypes.sol

```solidity
// 新增 enum
enum ContentLocation {
    Onchain,   // 0: content passed as calldata, stored in event
    External,  // 1: IPFS/Arweave, contentBaseUrl + contentHash
    HTTP       // 2: HTTP URL, contentBaseUrl + path
}

// 新增 struct — 统一内容提交参数，替代原来分散的 contentHash + declaredLength + contentBaseUrl
struct ContentSubmission {
    bytes32 contentHash;      // keccak256(content) 用于校验
    uint64 declaredLength;    // 内容字节长度
    bytes content;            // Onchain 模式: 实际内容; External/HTTP 模式: 空 bytes
}

// NovelConfig 改动:
//   - 删除 contentBaseUrl (移到 NovelConfig 外部或保留但仅 External/HTTP 模式使用)
//   - 新增 contentLocation
struct NovelConfig {
    uint64 minChapterLength;
    uint64 maxChapterLength;
    uint64 roundMinDuration;
    uint32 roundMinSubmissions;
    uint32 worldLineCount;
    uint32 roundsPerEpoch;
    uint16 prizeReleaseRate;
    uint16 voterRewardRate;
    uint64 commitDuration;
    uint64 revealDuration;
    uint256 stakeAmount;
    uint8 pollutionRounds;
    uint8 pollutionThreshold;
    ContentLocation contentLocation;  // 替代 contentBaseUrl
    string contentBaseUrl;            // 仅 External/HTTP 模式需要, Onchain 模式忽略
}
```

#### 1.2 INovelCore.sol

```solidity
// 新增 event
event ChapterContentStored(uint256 indexed novelId, uint256 indexed chapterId, bytes content);

// submitChapter 签名改为接收 ContentSubmission
function submitChapter(
    uint256 novelId,
    uint256 parentChapterId,
    DataTypes.ContentSubmission calldata submission
) external payable returns (uint256 chapterId);

// createNovel — genesisContentHashes + genesisLengths 合并为 ContentSubmission[]
function createNovel(
    DataTypes.NovelConfig calldata config,
    DataTypes.NovelMetadata calldata metadata,
    DataTypes.ContentSubmission[] calldata genesisChapters
) external payable returns (uint256 novelId);
```

#### 1.3 NovelCore.sol

**submitChapter 逻辑:**
```
if contentLocation == Onchain:
    require(submission.content.length > 0)
    require(keccak256(submission.content) == submission.contentHash)
    require(submission.content.length == submission.declaredLength)
    emit ChapterContentStored(novelId, chapterId, submission.content)
else:
    // External / HTTP: content 应为空, 只存 hash
    require(submission.content.length == 0)
    // contentHash + declaredLength 由调用者提供, 不验证内容
```

**createNovel 逻辑:**
- 遍历 `genesisChapters[]`, 同样按 contentLocation 分支处理
- 每个 genesis chapter 用 `submission.contentHash` 和 `submission.declaredLength`

**_validateConfig 新增:**
- 如果 `contentLocation == External || contentLocation == HTTP`:
  `require(bytes(config.contentBaseUrl).length > 0)`
- 如果 `contentLocation == Onchain`:
  contentBaseUrl 忽略 (可以为空)

#### 1.4 影响的合约文件清单

```
[ ] src/libraries/DataTypes.sol
    - 新增 ContentLocation enum
    - 新增 ContentSubmission struct
    - NovelConfig 新增 contentLocation 字段 (contentBaseUrl 保留)
[ ] src/interfaces/INovelCore.sol
    - 新增 ChapterContentStored event
    - submitChapter 签名改为 ContentSubmission
    - createNovel 签名: genesisContentHashes+genesisLengths → ContentSubmission[]
    - forkNovel 不变 (fork 不创建新 content, 复用源章节)
[ ] src/core/NovelCore.sol
    - submitChapter: 按 contentLocation 分支 (onchain emit event / external 只存 hash)
    - createNovel: 遍历 ContentSubmission[], 同上
    - _validateConfig: 校验 contentLocation 和 contentBaseUrl 一致性
    - genesis 章节创建逻辑适配 ContentSubmission
[ ] src/core/ChapterNFT.sol — 不变 (不涉及内容)
[ ] src/core/VotingEngine.sol — 不变
[ ] src/core/PrizePool.sol — 不变
```

---

### 2. 合约测试改动

所有测试中的 `createNovel` 和 `submitChapter` 调用签名都需要适配。

```
[ ] test/Integration.t.sol  — _createNovel helper + 所有 createNovel/submitChapter 调用
[ ] test/E2E.t.sol          — 同上, 多个测试函数
[ ] test/Fuzz.t.sol         — createNovel + submitChapter 调用
[ ] test/GasProfile.t.sol   — 同上
[ ] test/Reentrancy.t.sol   — 同上
[ ] test/Upgrade.t.sol      — 同上
```

建议: 在测试中使用 Onchain 模式 (最容易测试), 构造 helper:
```solidity
function _makeSubmission(bytes memory content) internal pure returns (DataTypes.ContentSubmission memory) {
    return DataTypes.ContentSubmission({
        contentHash: keccak256(content),
        declaredLength: uint64(content.length),
        content: content
    });
}
```

---

### 3. MCP 改动

```
[ ] mcp/src/abi/index.ts
    - createNovel ABI: 参数从 (config, metadata, bytes32[], uint64[]) → (config, metadata, ContentSubmission[])
    - submitChapter ABI: 参数从 (novelId, parentId, bytes32, uint64) → (novelId, parentId, ContentSubmission)
    - NovelConfig tuple 新增 contentLocation (uint8)
    - 新增 ChapterContentStored event
[ ] mcp/src/tools/novel.ts
    - create_novel: 构造 ContentSubmission[] 替代 hashes+lengths
    - 新增 contentLocation 参数 (默认 onchain)
[ ] mcp/src/tools/chapter.ts
    - submit_chapter: 构造 ContentSubmission 替代 contentHash+declaredLength
    - onchain 模式: content 参数必填
    - external 模式: contentHash 必填, content 为空
[ ] mcp/src/skills/writer.ts — 适配新签名
[ ] mcp/src/utils/content-bridge.ts — 可能需要适配
[ ] mcp/e2e-mcp-test.ts — 适配新签名
```

---

### 4. Web Backend 改动

#### 4.1 新增 Content Upload API

```
[ ] src/api/content.ts — POST /api/content/upload
    - 接收: { content: string, novelId: number }
    - 查 novel 的 contentLocation:
      - Onchain: 不需要上传, 直接返回 { contentHash: keccak256(content), declaredLength }
      - External: 上传到配置的存储 (Arweave/IPFS), 返回 { contentHash, declaredLength }
      - HTTP: 上传到对象存储 (S3/R2), 返回 { contentHash, declaredLength, url }
    - 可选: 钱包签名验证身份
```

#### 4.2 Indexer 改动

```
[ ] src/indexer/handlers.ts
    - ChapterContentStored event handler: 直接提取 content 存入 chapters.content_text
    - ChapterSubmitted handler:
      - 查 novel.contentLocation
      - Onchain: 不触发 content fetcher (content 已从 event 提取)
      - External/HTTP: 触发 content fetcher (与现在逻辑相同)
[ ] src/indexer/content-fetcher.ts
    - 只在 External/HTTP 模式下工作
    - 无需改动逻辑, 但可加 locationType 检查跳过 onchain 小说
[ ] src/utils/abi.ts
    - 新增 ChapterContentStored event ABI
    - 更新 createNovel/submitChapter ABI
```

#### 4.3 DB Schema

```
[ ] migrations/005_content_location.sql
    - novels 表新增: content_location SMALLINT DEFAULT 0  (0=onchain, 1=external, 2=http)
    - 现有数据默认 0 (onchain)
```

#### 4.4 其他 Backend 文件

```
[ ] src/api/novels.ts — novel 详情返回 content_location 字段
[ ] src/api/chapters.ts — 不变 (content_text 统一从 DB 读取)
[ ] src/index.ts — 注册 content 路由
```

---

### 5. Web Frontend 改动

#### 5.1 删除 Arweave 依赖

```
[ ] 删除 src/lib/arweave.ts
[ ] package.json: 移除 @irys/web-upload, @irys/web-upload-ethereum-viem-v2
```

#### 5.2 封面图改为 URL 输入

```
[ ] src/app/create/page.tsx
    - 删除封面上传按钮和 uploadFile 调用
    - 改为纯文本 input: "Cover Image URL (optional)"
[ ] src/app/fork/[novelId]/[chapterId]/page.tsx — 同上
```

#### 5.3 内容提交流程改造

**Onchain 模式 (推荐):**
```
用户写内容 → 前端构造 ContentSubmission { contentHash, declaredLength, content }
           → 直接调用 submitChapter(novelId, parentId, submission)
           → 一笔交易完成, 无需后端
```

**External/HTTP 模式:**
```
用户写内容 → POST /api/content/upload → 获取 { contentHash, declaredLength }
           → 前端构造 ContentSubmission { contentHash, declaredLength, content: "0x" }
           → 调用 submitChapter
```

```
[ ] src/app/write/[novelId]/[parentId]/page.tsx
    - 去掉 Arweave import
    - 查 novel.contentLocation, 按模式分支:
      - Onchain: 直接构造 ContentSubmission 含 content bytes, 一笔 tx
      - External/HTTP: 先 POST /api/content/upload, 再 submitChapter
    - 简化为单步操作 (onchain) 或两步 (external)
[ ] src/app/create/page.tsx
    - 新增 contentLocation 选择 (Onchain / External / HTTP, 默认 Onchain)
    - genesis 章节提交: 构造 ContentSubmission[]
    - 去掉 Arweave 上传代码
[ ] src/app/fork/[novelId]/[chapterId]/page.tsx
    - 同 create, 适配 contentLocation
[ ] src/lib/contracts.ts
    - submitChapter ABI 更新
    - createNovel ABI 更新
    - forkNovel ABI 不变
[ ] src/lib/api.ts
    - Novel type 新增 content_location 字段
```

#### 5.4 举报 (Report) 改动

```
[ ] src/components/report-modal.tsx
    - 去掉 Arweave 上传证据
    - 改为: 直接用 keccak256(evidence text) 作为 evidenceHash
    - 或 POST /api/content/upload 存证据, 返回 hash
```

---

### 6. E2E 测试脚本改动

```
[ ] script/e2e-test.sh
    - createNovel 调用签名适配 ContentSubmission[]
    - submitChapter 调用签名适配 ContentSubmission
    - Onchain 模式: content 直接传入
[ ] web/backend/e2e-test.sh
    - 同上
    - 新增验证: ChapterContentStored event 被 indexer 正确处理
    - 新增验证: chapter.content_text 从 event 中正确提取
```

---

### 7. 文档更新

```
[ ] docs/web_requirements_cn.md — Content Upload Proxy 章节更新为可插拔方案
[ ] docs/web_plan.md — Phase 3 更新
[ ] web/README.md — 更新架构说明
[ ] CLAUDE.md — 如有相关描述需更新
```

---

### 执行顺序

```
Step 1: 合约改动 (DataTypes → INovelCore → NovelCore → tests → forge test)
Step 2: MCP 适配 (ABI → tools → skills)
Step 3: Web Backend (migration → indexer → content API → e2e test)
Step 4: Web Frontend (删 Arweave → 改 create/write/fork → 改 contracts.ts)
Step 5: E2E 测试脚本更新
Step 6: 文档更新
```

### 风险评估

- **合约改动较大**: submitChapter 和 createNovel 签名都变了, 所有调用方都需适配
- **Onchain 模式 gas 成本**: 需要在目标 L2 上实测, 确认大章节 (50KB) 的 gas 可接受
- **向后兼容**: 这是 breaking change, 需要全量重新部署
- **ContentSubmission.content 是 bytes**: 前端需要 UTF-8 encode 文本为 bytes
