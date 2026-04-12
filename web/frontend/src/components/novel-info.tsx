"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { parseEther, formatEther } from "viem";
import type { Novel } from "@/lib/api";
import { fetchNickname } from "@/lib/api";
import { shortAddress, formatBalance, formatDuration } from "@/lib/format";
import { phaseLabel, TOKEN_SYMBOL } from "@/lib/config";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { useTxAction } from "@/hooks/use-tx-action";

function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block", marginLeft: "0.25rem" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="on-tip-trigger"
      >?</button>
      {open && (
        <span className="on-tip-popup">
          {text}
        </span>
      )}
    </span>
  );
}

function ConfigItem({ label, value, tip }: { label: string; value: string | number; tip: string }) {
  return (
    <div style={{ fontSize: "0.8125rem" }}>
      <span className="text-muted">{label}<Tip text={tip} /></span>
      <span style={{ marginLeft: "0.375rem", color: "var(--color-text)" }}>{value}</span>
    </div>
  );
}

function usePhaseRemaining(novel: Novel): string | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!novel.active) return;

    function calc() {
      const now = Math.floor(Date.now() / 1000);
      const c = novel.config;
      const phaseStart = Number(novel.phase_start_time || 0);
      const lastSettle = Number(novel.last_settle_time || 0);

      let deadline = 0;
      switch (novel.round_phase) {
        case 0: // Idle — next round can start after minRoundGap
          deadline = lastSettle + Number(c.minRoundGap || 0);
          break;
        case 1: // Nominating
          deadline = phaseStart + Number(c.nominateDuration || 0);
          break;
        case 2: // Committing
          deadline = phaseStart + Number(c.commitDuration || 0);
          break;
        case 3: // Revealing
          deadline = phaseStart + Number(c.revealDuration || 0);
          break;
      }
      return Math.max(0, deadline - now);
    }

    setRemaining(calc());
    const timer = setInterval(() => setRemaining(calc()), 1000);
    return () => clearInterval(timer);
  }, [novel.active, novel.round_phase, novel.phase_start_time, novel.last_settle_time, novel.config]);

  if (remaining === null || !novel.active) return null;
  if (remaining <= 0) return "ready";

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  if (h > 0) return `${h}h ${m}m remaining`;
  if (m > 0) return `${m}m ${s}s remaining`;
  return `${s}s remaining`;
}

function TipNovelButton({ novelId }: { novelId: string }) {
  const { isConnected } = useAccount();
  const [showInput, setShowInput] = useState(false);
  const [amount, setAmount] = useState("0.01");
  const { send, isPending, status, error, reset } = useTxAction();

  if (!isConnected) return null;

  async function handleTip() {
    const value = parseEther(amount);
    await send(
      {
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "tipNovel",
        args: [BigInt(novelId)],
        value,
      },
      () => { setTimeout(() => { setShowInput(false); setAmount("0.01"); reset(); }, 2000); }
    );
  }

  if (!showInput) {
    return (
      <button type="button" className="on-btn on-btn-secondary" onClick={() => setShowInput(true)}>
        Tip This Novel
      </button>
    );
  }

  return (
    <div className="on-row">
      {status !== "success" && (
        <input type="text" className="on-form-input on-form-input-narrow" value={amount} onChange={(e) => setAmount(e.target.value)} />
      )}
      {status !== "success" && (
        <button type="button" className="on-btn on-btn-primary" onClick={handleTip} disabled={isPending}>
          {status === "confirming" ? "Confirm in wallet..." : status === "waiting" ? "Waiting for block..." : "Send Tip"}
        </button>
      )}
      {!isPending && status !== "success" && <button type="button" className="on-btn on-btn-ghost" onClick={() => setShowInput(false)}>Cancel</button>}
      {status === "success" && <span className="text-success">Tip sent!</span>}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}

interface NovelInfoProps {
  novel: Novel;
  worldLineCount?: number;
  worldlinesWithContinuations?: number;
  totalWorldlines?: number;
}

export function NovelInfo({
  novel,
  worldLineCount = 0,
  worldlinesWithContinuations = 0,
  totalWorldlines = 0,
}: NovelInfoProps) {
  const phase = phaseLabel(novel.round_phase);
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    fetchNickname(novel.creator).then(r => {
      if (r.nickname) setCreatorName(r.nickname);
    }).catch(() => {});
  }, [novel.creator]);

  // Compute reward estimates
  const poolWei = BigInt(novel.pool_balance || "0");
  const releaseRate = novel.config?.prizeReleaseRate ?? 0;
  const voterRate = novel.config?.voterRewardRate ?? 0;
  const roundRelease = poolWei * BigInt(releaseRate) / BigInt(10000);
  // Creator royalty: D/(D+round) where D=3
  const round = novel.current_round || 1;
  const creatorShare = roundRelease * BigInt(3) / BigInt(3 + round);
  const remaining = roundRelease - creatorShare;
  const voterReward = remaining * BigInt(voterRate) / BigInt(10000);
  const authorReward = remaining - voterReward;

  const phaseRemaining = usePhaseRemaining(novel);
  const c = novel.config;
  const fmtWei = (v: string | number) => {
    const n = parseFloat(formatEther(BigInt(v || "0")));
    if (n === 0) return `0 ${TOKEN_SYMBOL}`;
    if (n < 0.0001) return `<0.0001 ${TOKEN_SYMBOL}`;
    return `${n.toFixed(4)} ${TOKEN_SYMBOL}`;
  };

  return (
    <div className="on-card on-stack" style={{ gap: "0.75rem" }}>
      {/* Header: cover + title + description */}
      <div className="on-row" style={{ gap: "1rem", alignItems: "flex-start" }}>
        {novel.cover_uri && (
          <img
            src={novel.cover_uri}
            alt=""
            className="on-cover on-cover-lg"
          />
        )}
        <div className="on-flex-1">
          <div className="on-row-between" style={{ flexWrap: "wrap" }}>
            <h1 className="text-heading" style={{ margin: 0 }}>
              {novel.title || `Novel #${novel.id}`}
            </h1>
            <span className={`on-badge ${novel.active ? "badge-active" : "badge-completed"}`}>
              {novel.active ? "Active" : "Completed"}
            </span>
          </div>
          {novel.description && (
            <p className="text-body" style={{ margin: 0, marginTop: "0.5rem" }}>{novel.description}</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="on-row" style={{ gap: "1rem", flexWrap: "wrap" }}>
        <span className="text-caption">Creator: {creatorName || shortAddress(novel.creator)}</span>
        <span className="text-caption">
          Round {novel.current_round} &middot; {phase}
          {phaseRemaining && (
            <span style={{ marginLeft: "0.25rem", color: phaseRemaining === "ready" ? "var(--color-success)" : "var(--color-warning)" }}>
              ({phaseRemaining})
            </span>
          )}
        </span>
        <span className="text-caption">{novel.chapter_count} chapters</span>
        <span className="text-caption">{novel.author_count} authors</span>
        {c?.worldLineCount && <span className="text-caption">{c.worldLineCount} world lines</span>}
      </div>

      {/* Continuation readiness hint (only during Idle, when waiting to start next round) */}
      {novel.active && novel.round_phase === 0 && novel.current_round > 0 && worldLineCount > 0 && (
        <div style={{
          padding: "0.5rem 0.75rem", borderRadius: "0.5rem",
          background: worldlinesWithContinuations >= worldLineCount
            ? "var(--color-bg-secondary)"
            : "rgba(255, 165, 0, 0.08)",
          border: `1px solid ${worldlinesWithContinuations >= worldLineCount ? "var(--color-border)" : "var(--color-warning)"}`,
          fontSize: "0.8125rem",
        }}>
          {worldlinesWithContinuations >= worldLineCount ? (
            <span>✓ Ready for next round: all {totalWorldlines} world line(s) have continuations.</span>
          ) : (
            <span>
              Waiting for continuations: <b>{worldlinesWithContinuations}/{totalWorldlines}</b> world line(s) have a next chapter.
              The next round starts automatically when every world line has at least one continuation.
              Help out by writing the next chapter or sponsoring one.
            </span>
          )}
        </div>
      )}

      {/* Prize & Rewards row */}
      <div className="on-row-wrap" style={{
        gap: "1.5rem", padding: "0.75rem 1rem", borderRadius: "0.5rem",
        background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)",
      }}>
        <div>
          <div className="text-tiny">Total Pool</div>
          <div style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--color-warning)" }}>
            {formatBalance(novel.pool_balance)}
          </div>
        </div>
        <div>
          <div className="text-tiny">Round Release</div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-primary)" }}>
            {fmtWei(roundRelease.toString())}
          </div>
        </div>
        <div>
          <div className="text-tiny">Author Reward</div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-success)" }}>
            {fmtWei(authorReward.toString())}
          </div>
        </div>
        <div>
          <div className="text-tiny">Voter Reward</div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-primary)" }}>
            {fmtWei(voterReward.toString())}
          </div>
        </div>
      </div>

      {/* Configuration (collapsible) */}
      <div style={{
        border: "1px solid var(--color-border)", borderRadius: "0.5rem", overflow: "hidden",
      }}>
        <button
          onClick={() => setConfigOpen(!configOpen)}
          className="on-row-between"
          style={{
            width: "100%", padding: "0.5rem 0.75rem", background: "var(--color-bg-secondary)",
            border: "none", cursor: "pointer", color: "var(--color-text)", fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Configuration</span>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{configOpen ? "▲" : "▼"}</span>
        </button>
        {configOpen && c && (
          <div style={{ padding: "0.75rem", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))", gap: "0.5rem 1.5rem" }}>
            <ConfigItem label="Chapter Length" value={`${c.minChapterLength} – ${c.maxChapterLength} bytes`}
              tip="Min/max content size in bytes per submission. CJK characters are ~3 bytes each." />
            <ConfigItem label="Submission Fee" value={fmtWei(c.submissionFee)}
              tip="Fee per chapter submission. Goes to the prize pool. Acts as anti-spam." />
            <ConfigItem label="World Lines" value={c.worldLineCount}
              tip="Number of parallel story branches kept each round. Top N voted chapters become world lines." />
            <ConfigItem label="Vote Stake" value={fmtWei(c.voteStake)}
              tip="Required stake per vote commitment. Refunded after reveal; forfeited if unrevealed." />
            <ConfigItem label="Nomination Fee" value={fmtWei(c.nominationFee)}
              tip="Fee to nominate an additional candidate chain during nomination phase." />
            <ConfigItem label="Nominate Duration" value={formatDuration(c.nominateDuration)}
              tip="Time for candidate nominations after a round starts." />
            <ConfigItem label="Commit Duration" value={formatDuration(c.commitDuration)}
              tip="Time for voters to submit encrypted vote commitments (commit-reveal scheme)." />
            <ConfigItem label="Reveal Duration" value={formatDuration(c.revealDuration)}
              tip="Time for voters to reveal their votes. Unrevealed votes lose their stake." />
            <ConfigItem label="Min Round Gap" value={formatDuration(c.minRoundGap)}
              tip="Minimum interval between the end of one round and the start of the next." />
            <ConfigItem label="Prize Release" value={`${(releaseRate / 100).toFixed(0)}%`}
              tip="Percentage of the prize pool released each round. Split into creator royalty, author rewards, and voter rewards." />
            <ConfigItem label="Voter Reward" value={`${(voterRate / 100).toFixed(0)}%`}
              tip="Share of round rewards allocated to voters. Accurate voters (voted for winner) get 3x weight." />
            {c.maxVoterReward && c.maxVoterReward !== "0" && (
              <ConfigItem label="Voter Cap" value={fmtWei(c.maxVoterReward)}
                tip="Per-address voter reward cap per round. Excess returns to the prize pool." />
            )}
            {c.unrevealPenaltyFloor && c.unrevealPenaltyFloor !== "0" && (
              <ConfigItem label="Unreveal Penalty Floor" value={fmtWei(c.unrevealPenaltyFloor)}
                tip="Minimum penalty for unrevealed votes. Effective penalty = max(this, voteStake × 20%)." />
            )}
            <ConfigItem label="Content Storage" value={["Onchain", "External (IPFS)", "HTTP"][c.contentLocation] || "Unknown"}
              tip="Where chapter content is stored. Onchain = in calldata; External = IPFS/Arweave; HTTP = CDN." />
            {c.ruleFee !== undefined && (
              <ConfigItem label="Rule Proposal Fee" value={fmtWei(c.ruleFee)}
                tip="Fee to propose a world-building rule. Goes to the prize pool." />
            )}
            {c.ruleQuorum !== undefined && (
              <ConfigItem label="Rule Quorum" value={c.ruleQuorum}
                tip="Number of world-line author votes needed to approve a rule proposal." />
            )}
            {c.ruleVoteDuration !== undefined && (
              <ConfigItem label="Rule Vote Duration" value={formatDuration(c.ruleVoteDuration)}
                tip="Time window for world-line authors to vote on a rule proposal." />
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="on-row-wrap">
        <Link href={`/novels/${novel.id}/tree`}>
          <button className="on-btn on-btn-secondary">Story Tree</button>
        </Link>
        <TipNovelButton novelId={novel.id} />
      </div>
    </div>
  );
}
