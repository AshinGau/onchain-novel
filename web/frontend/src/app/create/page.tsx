"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { keccak256, parseEther, toBytes, toHex, type TransactionReceipt } from "viem";
import { useAccount } from "wagmi";

import { ConfigForm } from "@/components/config-form";
import { useTxAction } from "@/hooks/use-tx-action";
import { TOKEN_SYMBOL } from "@/lib/config";
import {
  NOVEL_CORE_ADDRESS,
  novelCoreAbi,
  RULES_ENGINE_ADDRESS,
  rulesEngineAbi,
} from "@/lib/contracts";
import { DEFAULT_CONFIG, validateAllFields, type NovelConfigForm } from "@/lib/novel-config";

function extractNovelId(receipt: TransactionReceipt): bigint | null {
  const log = receipt.logs.find(
    (l) => l.address.toLowerCase() === NOVEL_CORE_ADDRESS.toLowerCase() && l.topics.length >= 2,
  );
  return log?.topics[1] ? BigInt(log.topics[1]) : null;
}

interface BootstrapChapter {
  content: string;
}

interface CreatorRule {
  name: string;
  content: string;
}

export default function CreateNovelPage() {
  const router = useRouter();
  const { isConnected } = useAccount();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUri, setCoverUri] = useState("");
  const [config, setConfig] = useState<NovelConfigForm>(DEFAULT_CONFIG);
  const [chapters, setChapters] = useState<BootstrapChapter[]>([{ content: "" }]);
  const [initialPrize, setInitialPrize] = useState("");
  const [creatorRules, setCreatorRules] = useState<CreatorRule[]>([]);
  const [validationError, setValidationError] = useState("");

  const hasRules =
    creatorRules.length > 0 && creatorRules.some((r) => r.name.trim() && r.content.trim());
  const ruleTx = useTxAction();
  const tx = useTxAction();

  function byteCount(text: string): number {
    return new TextEncoder().encode(text).length;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError("");
    if (!isConnected) {
      setValidationError("Please connect your wallet first.");
      return;
    }
    if (!title.trim()) {
      setValidationError("Title is required.");
      return;
    }
    if (chapters.some((ch) => !ch.content.trim())) {
      setValidationError("All bootstrap chapters must have content.");
      return;
    }
    // Validate content length against config
    for (let i = 0; i < chapters.length; i++) {
      const len = new TextEncoder().encode(chapters[i].content).length;
      if (len < config.minChapterLength) {
        setValidationError(
          `Chapter ${i + 1}: content too short (${len} bytes, min ${config.minChapterLength}).`,
        );
        return;
      }
      if (len > config.maxChapterLength) {
        setValidationError(
          `Chapter ${i + 1}: content too long (${len} bytes, max ${config.maxChapterLength}).`,
        );
        return;
      }
    }
    const configError = validateAllFields(config);
    if (configError) {
      setValidationError(configError);
      return;
    }

    // For now, only support single root chapter (first one)
    const ch = chapters[0];
    const contentBytes = toHex(toBytes(ch.content));
    const contentHash = keccak256(contentBytes);
    const declaredLength = BigInt(new TextEncoder().encode(ch.content).length);

    let value = BigInt(0);
    // submissionFee is required
    value += parseEther(config.submissionFee);
    if (initialPrize && parseFloat(initialPrize) > 0) {
      value += parseEther(initialPrize);
    }

    tx.send(
      {
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "createNovel",
        args: [
          {
            minChapterLength: BigInt(config.minChapterLength),
            maxChapterLength: BigInt(config.maxChapterLength),
            submissionFee: parseEther(config.submissionFee),
            worldLineCount: config.worldLineCount,
            voteStake: parseEther(config.voteStake),
            nominationFee: parseEther(config.nominationFee),
            nominateDuration: BigInt(config.nominateDuration),
            commitDuration: BigInt(config.commitDuration),
            revealDuration: BigInt(config.revealDuration),
            minRoundGap: BigInt(config.minRoundGap),
            prizeReleaseRate: config.prizeReleaseRate,
            voterRewardRate: config.voterRewardRate,
            contentLocation: config.contentLocation,
            contentBaseUrl: config.contentBaseUrl,
            ruleFee: parseEther(config.ruleFee),
            ruleVoteDuration: BigInt(config.ruleVoteDuration),
            ruleQuorum: config.ruleQuorum,
          },
          { title: title.trim(), description: description.trim(), coverUri: coverUri.trim() },
          { contentHash, declaredLength, content: contentBytes },
        ],
        value,
      },
      (receipt) => {
        const novelId = extractNovelId(receipt);
        if (novelId === null) return;
        if (!hasRules) {
          setTimeout(() => router.push(`/novels/${novelId}`), 1500);
          return;
        }
        const validRules = creatorRules.filter((r) => r.name.trim() && r.content.trim());
        ruleTx.send(
          {
            address: RULES_ENGINE_ADDRESS,
            abi: rulesEngineAbi,
            functionName: "setCreatorRules",
            args: [
              novelId,
              validRules.map((r) => r.name.trim()),
              validRules.map((r) => r.content.trim()),
            ],
          },
          () => {
            setTimeout(() => router.push(`/novels/${novelId}`), 1500);
          },
        );
      },
    );
  }

  const isBusy = tx.isPending || ruleTx.isPending;

  return (
    <div className="on-container" style={{ maxWidth: "800px" }}>
      <Link href="/novels" className="text-link text-caption">
        ← Back to Novels
      </Link>
      <h1 className="text-heading" style={{ marginTop: "1rem" }}>
        Create a Novel
      </h1>
      <p className="text-caption" style={{ marginBottom: "2rem" }}>
        Launch a new collaborative story on-chain.
      </p>

      <form onSubmit={handleSubmit} className="on-stack on-stack-lg">
        {/* Metadata */}
        <div className="on-card on-stack">
          <h2 className="text-subheading">Novel Metadata</h2>
          <div>
            <label className="on-form-label">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter novel title"
              className="on-form-input"
              required
            />
          </div>
          <div>
            <label className="on-form-label">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your novel..."
              rows={3}
              className="on-form-textarea"
            />
          </div>
          <div>
            <label className="on-form-label">Cover Image URL (optional)</label>
            <input
              type="text"
              value={coverUri}
              onChange={(e) => setCoverUri(e.target.value)}
              placeholder="https://..."
              className="on-form-input"
            />
          </div>
        </div>

        {/* Config */}
        <div className="on-card on-stack">
          <h2 className="text-subheading">Novel Configuration</h2>
          <ConfigForm config={config} onChange={setConfig} />
        </div>

        {/* Root Chapter */}
        <div className="on-card on-stack">
          <h2 className="text-subheading">Root Chapter</h2>
          <p className="text-tiny">Write the first chapter of your story.</p>
          {chapters.map((ch, i) => (
            <div key={i}>
              <div className="on-row-between" style={{ marginBottom: "0.25rem" }}>
                <span className="on-form-label">Chapter {i + 1}</span>
                <span
                  className="text-tiny"
                  style={{
                    color:
                      byteCount(ch.content) < config.minChapterLength ||
                      byteCount(ch.content) > config.maxChapterLength
                        ? "var(--color-danger)"
                        : undefined,
                  }}
                >
                  {byteCount(ch.content)} bytes (min: {config.minChapterLength}, max:{" "}
                  {config.maxChapterLength})
                </span>
              </div>
              <textarea
                value={ch.content}
                onChange={(e) =>
                  setChapters((prev) =>
                    prev.map((c, j) => (j === i ? { content: e.target.value } : c)),
                  )
                }
                placeholder="Write your chapter..."
                rows={10}
                className="on-form-textarea"
              />
            </div>
          ))}
        </div>

        {/* Creator Rules */}
        <div className="on-card on-stack">
          <div className="on-row-between">
            <h2 className="text-subheading">Initial Rules (Optional)</h2>
            <button
              type="button"
              onClick={() => setCreatorRules((prev) => [...prev, { name: "", content: "" }])}
              className="on-btn on-btn-secondary"
            >
              + Add Rule
            </button>
          </div>
          <p className="text-tiny">
            World-building metadata for collaborating AI agents (e.g., setting, characters, plot
            direction). Requires a second transaction after novel creation.
          </p>
          {creatorRules.map((rule, i) => (
            <div key={i} className="on-card" style={{ background: "var(--color-bg-secondary)" }}>
              <div className="on-row-between">
                <span className="on-form-label">Rule {i + 1}</span>
                <button
                  type="button"
                  onClick={() => setCreatorRules((prev) => prev.filter((_, j) => j !== i))}
                  className="text-danger"
                  style={{
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                  }}
                >
                  Remove
                </button>
              </div>
              <input
                type="text"
                value={rule.name}
                onChange={(e) =>
                  setCreatorRules((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                  )
                }
                placeholder="Rule name (e.g., setting, protagonist, tone)"
                maxLength={64}
                className="on-form-input"
              />
              <textarea
                value={rule.content}
                onChange={(e) =>
                  setCreatorRules((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, content: e.target.value } : r)),
                  )
                }
                placeholder="Rule content..."
                rows={3}
                className="on-form-textarea"
              />
            </div>
          ))}
        </div>

        {/* Initial Prize Pool */}
        <div className="on-card on-stack">
          <h2 className="text-subheading">Initial Prize Pool</h2>
          <div>
            <label className="on-form-label">{TOKEN_SYMBOL} Amount (optional)</label>
            <input
              type="text"
              value={initialPrize}
              onChange={(e) => setInitialPrize(e.target.value)}
              placeholder="0.0"
              className="on-form-input"
            />
            <p className="text-tiny" style={{ marginTop: "0.25rem" }}>
              Seed the prize pool to attract early participants.
            </p>
          </div>
        </div>

        {/* Status */}
        {validationError && (
          <div
            className="on-card"
            style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
          >
            {validationError}
          </div>
        )}
        {tx.error && (
          <div
            className="on-card"
            style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
          >
            {tx.error}
          </div>
        )}
        {tx.status === "success" && !ruleTx.isPending && !ruleTx.error && !hasRules && (
          <div
            className="on-card"
            style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}
          >
            Novel created! Redirecting...
          </div>
        )}
        {ruleTx.isPending && (
          <div
            className="on-card"
            style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
          >
            Novel created. Setting initial rules...
          </div>
        )}
        {ruleTx.error && (
          <div
            className="on-card"
            style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
          >
            Novel created but failed to set rules: {ruleTx.error}
          </div>
        )}
        {ruleTx.status === "success" && (
          <div
            className="on-card"
            style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}
          >
            Novel created with rules! Redirecting...
          </div>
        )}

        <button
          type="submit"
          disabled={isBusy || !isConnected}
          className="on-btn on-btn-primary"
          style={{ width: "100%", justifyContent: "center", padding: "0.75rem" }}
        >
          {isBusy
            ? "Processing..."
            : !isConnected
              ? "Connect Wallet to Create"
              : hasRules
                ? "Create Novel & Set Rules"
                : "Create Novel"}
        </button>
      </form>
    </div>
  );
}
