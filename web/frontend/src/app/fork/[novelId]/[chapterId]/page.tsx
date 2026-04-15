"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { keccak256, parseEther, toBytes, toHex } from "viem";
import { useAccount } from "wagmi";

import { ConfigForm } from "@/components/config-form";
import { useTxAction } from "@/hooks/use-tx-action";
import { fetchNovel, type Novel } from "@/lib/api";
import { TOKEN_SYMBOL } from "@/lib/config";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { formatBalance } from "@/lib/format";
import { DEFAULT_CONFIG, validateAllFields, type NovelConfigForm } from "@/lib/novel-config";

interface BootstrapChapter {
  content: string;
}

export default function ForkNovelPage({
  params,
}: {
  params: Promise<{ novelId: string; chapterId: string }>;
}) {
  const { novelId, chapterId } = use(params);
  const router = useRouter();
  const { isConnected } = useAccount();

  const [sourceNovel, setSourceNovel] = useState<Novel | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUri, setCoverUri] = useState("");
  const [config, setConfig] = useState<NovelConfigForm>(DEFAULT_CONFIG);
  const [rootContent, setRootContent] = useState("");
  const [forkFee, setForkFee] = useState("");
  const [validationError, setValidationError] = useState("");

  const tx = useTxAction();

  useEffect(() => {
    async function load() {
      try {
        const novel = await fetchNovel(novelId);
        setSourceNovel(novel);
        const c = novel.config;
        setConfig({
          minChapterLength: Number(c.minChapterLength),
          maxChapterLength: Number(c.maxChapterLength),
          submissionFee: (Number(c.submissionFee) / 1e18).toString(),
          worldLineCount: c.worldLineCount,
          voteStake: (Number(c.voteStake) / 1e18).toString(),
          nominationFee: (Number(c.nominationFee) / 1e18).toString(),
          nominateDuration: Number(c.nominateDuration),
          commitDuration: Number(c.commitDuration),
          revealDuration: Number(c.revealDuration),
          minRoundGap: Number(c.minRoundGap),
          prizeReleaseRate: c.prizeReleaseRate,
          voterRewardRate: c.voterRewardRate,
          contentLocation: c.contentLocation,
          contentBaseUrl: c.contentBaseUrl,
          ruleFee: "0.001",
          ruleVoteDuration: 259200,
          ruleQuorum: 7,
        });
        setForkFee((Number(c.submissionFee) / 1e18).toString());
      } catch {
        setFetchError("Failed to load source novel.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [novelId]);

  function byteCount(text: string): number {
    return new TextEncoder().encode(text).length;
  }

  function handleSubmit(e: React.FormEvent) {
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
    if (!rootContent.trim()) {
      setValidationError("Root chapter content is required.");
      return;
    }
    const contentLen = new TextEncoder().encode(rootContent).length;
    if (contentLen < config.minChapterLength) {
      setValidationError(
        `Content too short (${contentLen} bytes, min ${config.minChapterLength}).`,
      );
      return;
    }
    if (contentLen > config.maxChapterLength) {
      setValidationError(`Content too long (${contentLen} bytes, max ${config.maxChapterLength}).`);
      return;
    }
    if (!forkFee || parseFloat(forkFee) <= 0) {
      setValidationError("Fork fee is required.");
      return;
    }
    const configError = validateAllFields(config);
    if (configError) {
      setValidationError(configError);
      return;
    }

    const contentBytes = toHex(toBytes(rootContent));
    const contentHash = keccak256(contentBytes);
    const declaredLength = BigInt(new TextEncoder().encode(rootContent).length);

    tx.send(
      {
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "forkNovel",
        args: [
          BigInt(chapterId),
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
        value: parseEther(forkFee),
      },
      () => {
        setTimeout(() => router.push("/novels"), 2000);
      },
    );
  }

  if (loading) {
    return (
      <div className="on-container" style={{ maxWidth: "800px" }}>
        <p className="text-caption">Loading source novel...</p>
      </div>
    );
  }
  if (fetchError) {
    return (
      <div className="on-container" style={{ maxWidth: "800px" }}>
        <p className="text-danger">{fetchError}</p>
      </div>
    );
  }

  return (
    <div className="on-container" style={{ maxWidth: "800px" }}>
      <Link href={`/novels/${novelId}`} className="text-link text-caption">
        ← Back to Novel
      </Link>
      <h1 className="text-heading" style={{ marginTop: "1rem" }}>
        Fork a Novel
      </h1>
      <p className="text-caption" style={{ marginBottom: "2rem" }}>
        Create a new novel branching from an existing chapter.
      </p>

      <div className="on-card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="text-subheading">Fork Source</h2>
        <p className="text-caption">
          Forking from <strong>{sourceNovel?.title || `Novel #${novelId}`}</strong>, Chapter #
          {chapterId}
        </p>
        {sourceNovel?.description && <p className="text-tiny">{sourceNovel.description}</p>}
      </div>

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
              placeholder="Describe your forked novel..."
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
          <p className="text-tiny">Prefilled from the source novel. You can modify these.</p>
          <ConfigForm config={config} onChange={setConfig} contentLocationReadOnly />
        </div>

        {/* Root Chapter */}
        <div className="on-card on-stack">
          <h2 className="text-subheading">Fork Root Chapter</h2>
          <p className="text-tiny">Write new content for the fork root chapter.</p>
          <div className="on-row-between" style={{ marginBottom: "0.25rem" }}>
            <span className="on-form-label">Content</span>
            <span
              className="text-tiny"
              style={{
                color:
                  byteCount(rootContent) < config.minChapterLength ||
                  byteCount(rootContent) > config.maxChapterLength
                    ? "var(--color-danger)"
                    : undefined,
              }}
            >
              {byteCount(rootContent)} bytes (min: {config.minChapterLength}, max:{" "}
              {config.maxChapterLength})
            </span>
          </div>
          <textarea
            value={rootContent}
            onChange={(e) => setRootContent(e.target.value)}
            placeholder="Write your fork root chapter..."
            rows={10}
            className="on-form-textarea"
          />
        </div>

        {/* Fork Fee */}
        <div className="on-card on-stack">
          <h2 className="text-subheading">Fork Fee</h2>
          <div>
            <label className="on-form-label">{TOKEN_SYMBOL} Amount</label>
            <input
              type="text"
              value={forkFee}
              onChange={(e) => setForkFee(e.target.value)}
              placeholder="0.0"
              className="on-form-input"
            />
            <p className="text-tiny" style={{ marginTop: "0.25rem" }}>
              Fee goes to the original novel's prize pool.
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
        {tx.status === "success" && (
          <div
            className="on-card"
            style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}
          >
            Novel forked! Redirecting...
          </div>
        )}

        <button
          type="submit"
          disabled={tx.isPending || !isConnected}
          className="on-btn on-btn-primary"
          style={{ width: "100%", justifyContent: "center", padding: "0.75rem" }}
        >
          {tx.isPending ? "Processing..." : !isConnected ? "Connect Wallet to Fork" : "Fork Novel"}
        </button>
      </form>
    </div>
  );
}
