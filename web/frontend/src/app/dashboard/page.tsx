"use client";

import { useAccount, useReadContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState, useEffect } from "react";
import Link from "next/link";
import { toHex } from "viem";
import { NOVEL_CORE_ADDRESS, novelCoreAbi, PRIZE_POOL_ADDRESS, prizePoolAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL } from "@/lib/config";
import {
  fetchUserChapters, fetchUserVotes, fetchUserRewards,
  fetchNickname,
  type UserChapter, type UserVote, type RewardSummary,
} from "@/lib/api";
import { shortAddress, formatBalance, formatEth, timeAgo } from "@/lib/format";
import { useTxAction } from "@/hooks/use-tx-action";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [chapters, setChapters] = useState<UserChapter[]>([]);
  const [votes, setVotes] = useState<UserVote[]>([]);
  const [rewards, setRewards] = useState<RewardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Nickname
  const [nickname, setNickname] = useState("");
  const [currentNickname, setCurrentNickname] = useState<string | null>(null);
  const nicknameTx = useTxAction();

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setFetchError(null);
    Promise.all([
      fetchUserChapters(address),
      fetchUserVotes(address),
      fetchUserRewards(address),
      fetchNickname(address),
    ]).then(([chData, voteData, rewardData, nicknameData]) => {
      setChapters(chData.chapters || []);
      setVotes(voteData.votes || []);
      setRewards(rewardData);
      setCurrentNickname(nicknameData.nickname);
    }).catch((err) => {
      setFetchError(`Failed to load dashboard data: ${err.message}`);
    }).finally(() => {
      setLoading(false);
    });
  }, [address]);

  function handleSetNickname() {
    if (!nickname.trim()) return;
    const bytes = new TextEncoder().encode(nickname.trim());
    if (bytes.length > 32) {
      alert("Nickname must be 32 bytes or less.");
      return;
    }
    // Pad to 32 bytes
    const padded = new Uint8Array(32);
    padded.set(bytes);
    const hex = toHex(padded) as `0x${string}`;

    nicknameTx.send({
      address: NOVEL_CORE_ADDRESS,
      abi: novelCoreAbi,
      functionName: "setNickname",
      args: [hex],
    }, () => { setCurrentNickname(nickname.trim()); });
  }

  if (!isConnected) {
    return (
      <div className="on-container on-text-center" style={{ paddingTop: "4rem" }}>
        <h1 className="text-heading">My Dashboard</h1>
        <p className="text-caption" style={{ margin: "1rem 0 1.5rem" }}>Connect your wallet to view your activity.</p>
        <ConnectButton />
      </div>
    );
  }

  const pendingReveals = votes.filter(v => !v.revealed && !v.claimed && v.round_phase === 3);

  return (
    <div className="on-container" style={{ maxWidth: "1000px" }}>
      <div className="on-row-between" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 className="text-heading">My Dashboard</h1>
          <p className="text-caption">{currentNickname ? `${currentNickname} · ` : ""}{shortAddress(address!)}</p>
        </div>
      </div>

      {/* Nickname Setting — only show if not yet set */}
      {!currentNickname && (
        <div className="on-card" style={{ marginBottom: "1rem" }}>
          <h3 className="text-subheading" style={{ marginBottom: "0.5rem" }}>Set Display Name</h3>
          <p className="text-tiny text-muted" style={{ marginBottom: "0.5rem" }}>
            Choose carefully — your display name cannot be changed once set.
          </p>
          <div className="on-row">
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Your nickname (max 32 bytes)"
              maxLength={32}
              className="on-form-input"
              style={{ flex: 1 }}
            />
            <button
              onClick={handleSetNickname}
              disabled={nicknameTx.isPending || !nickname.trim()}
              className="on-btn on-btn-primary"
            >
              {nicknameTx.isPending ? "Saving..." : nicknameTx.status === "success" ? "Saved!" : "Save"}
            </button>
          </div>
          <p className="text-tiny" style={{ marginTop: "0.25rem" }}>
            {new TextEncoder().encode(nickname).length}/32 bytes
          </p>
          {nicknameTx.error && <p className="text-danger" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>{nicknameTx.error}</p>}
        </div>
      )}

      {fetchError && (
        <div className="on-card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)", marginBottom: "1rem" }}>
          {fetchError}
        </div>
      )}

      {/* Urgent: pending reveals */}
      {pendingReveals.length > 0 && (
        <div className="on-card" style={{ borderColor: "var(--color-warning)", marginBottom: "1rem" }}>
          <h2 className="text-subheading" style={{ color: "var(--color-warning)" }}>Action Required: Reveal Your Votes</h2>
          <p className="text-caption">
            You have {pendingReveals.length} vote(s) waiting to be revealed. Unrevealed votes will be forfeited.
          </p>
          {pendingReveals.map(v => (
            <Link key={`${v.novel_id}-${v.round}`} href={`/novels/${v.novel_id}`} className="text-link" style={{ display: "block" }}>
              {v.novel_title || `Novel #${v.novel_id}`}
            </Link>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-caption">Loading...</p>
      ) : (
        <Tabs defaultValue="chapters">
          <TabsList>
            <TabsTrigger value="chapters">My Chapters ({chapters.length})</TabsTrigger>
            <TabsTrigger value="votes">My Votes ({votes.length})</TabsTrigger>
            <TabsTrigger value="rewards">Rewards</TabsTrigger>
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
          </TabsList>

          <TabsContent value="chapters">
            {chapters.length === 0 ? (
              <p className="text-caption on-empty">No chapters submitted yet.</p>
            ) : (
              <div className="on-stack on-stack-sm" style={{ marginTop: "0.75rem" }}>
                {chapters.map(ch => (
                  <Link key={ch.id} href={`/novels/${ch.novel_id}/chapter/${ch.id}`} className="on-link-block">
                    <div className="on-card on-card-hover on-row-between" style={{ padding: "0.75rem 1rem" }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{ch.novel_title || `Novel #${ch.novel_id}`}</span>
                        <span className="text-caption" style={{ marginLeft: "0.5rem" }}>ID.{ch.id} · #{ch.depth}</span>
                      </div>
                      <div className="on-row" style={{ gap: "0.25rem" }}>
                        {ch.is_world_line && <span className="on-badge badge-worldline">WL</span>}
                        <span className="text-tiny">{timeAgo(ch.created_at)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="votes">
            {votes.length === 0 ? (
              <p className="text-caption on-empty">No votes cast yet.</p>
            ) : (
              <div className="on-stack on-stack-sm" style={{ marginTop: "0.75rem" }}>
                {votes.map((v, i) => (
                  <div key={i} className="on-card on-row-between" style={{ padding: "0.75rem 1rem" }}>
                    <div>
                      <Link href={`/novels/${v.novel_id}`} className="text-link" style={{ fontWeight: 600 }}>
                        {v.novel_title || `Novel #${v.novel_id}`}
                      </Link>
                      <span className="text-caption" style={{ marginLeft: "0.5rem" }}>Round {v.round}</span>
                      {v.candidate_id && <span className="text-caption" style={{ marginLeft: "0.5rem" }}>→ ID.{v.candidate_id}</span>}
                    </div>
                    <div className="on-row" style={{ gap: "0.25rem" }}>
                      {!v.revealed && <span className="on-badge" style={{ background: "var(--color-danger)", color: "white" }}>Unrevealed</span>}
                      {v.revealed && !v.claimed && <span className="on-badge badge-active">Revealed</span>}
                      {v.claimed && <span className="on-badge badge-completed">Claimed</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rewards">
            {!rewards ? (
              <p className="text-caption on-empty">Loading rewards...</p>
            ) : rewards.participatedNovels.length === 0 ? (
              <p className="text-caption on-empty">No reward activity yet. Participate in a novel to earn rewards.</p>
            ) : (
              <div className="on-stack" style={{ marginTop: "0.75rem" }}>
                {rewards.participatedNovels.map((pn) => (
                  <RewardsCard key={pn.novel_id} novelId={pn.novel_id} title={pn.novel_title} />
                ))}

                {rewards.rewardClaims.length > 0 && (
                  <div className="on-card">
                    <h3 className="text-subheading" style={{ marginBottom: "0.5rem" }}>Claim History</h3>
                    {rewards.rewardClaims.map((rc, i) => (
                      <div key={i} className="on-row-between text-caption" style={{ padding: "0.25rem 0" }}>
                        <span>{rc.novel_title || `Novel #${rc.novel_id}`} — {rc.source}</span>
                        <span style={{ color: "var(--color-success)" }}>{formatEth(rc.total_amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="drafts">
            <DraftsTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function RewardsCard({ novelId, title }: { novelId: string; title: string }) {
  const { address } = useAccount();

  const { data: pendingReward } = useReadContract({
    address: PRIZE_POOL_ADDRESS,
    abi: prizePoolAbi,
    functionName: "getPendingReward",
    args: address ? [BigInt(novelId), address] : undefined,
    query: { enabled: !!address },
  });

  const hasPending = pendingReward !== undefined && pendingReward > BigInt(0);
  const claimTx = useTxAction();

  return (
    <div className="on-card on-row-between" style={{ padding: "0.75rem 1rem" }}>
      <div>
        <Link href={`/novels/${novelId}`} className="text-link" style={{ fontWeight: 600 }}>
          {title || `Novel #${novelId}`}
        </Link>
        <p className="text-caption" style={{ marginTop: "0.25rem" }}>
          Pending: <span style={{ color: hasPending ? "var(--color-warning)" : "var(--color-text-muted)" }}>
            {pendingReward !== undefined ? formatBalance(pendingReward.toString()) : "..."}
          </span>
        </p>
      </div>
      {hasPending && (
        <button
          className="on-btn on-btn-primary"
          disabled={claimTx.isPending}
          onClick={() => claimTx.send({
            address: NOVEL_CORE_ADDRESS,
            abi: novelCoreAbi,
            functionName: "claimReward",
            args: [BigInt(novelId)],
          })}
        >
          {claimTx.isPending ? "Claiming..." : claimTx.status === "success" ? "Claimed!" : "Claim"}
        </button>
      )}
      {claimTx.error && <p className="text-danger" style={{ fontSize: "0.75rem" }}>{claimTx.error}</p>}
    </div>
  );
}

function DraftsTab() {
  const [drafts, setDrafts] = useState<{ key: string; novelId: string; parentId: string; preview: string }[]>([]);

  useEffect(() => {
    const found: typeof drafts = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("draft:")) {
        const parts = key.split(":");
        const novelId = parts[1];
        const parentId = parts[2];
        const content = localStorage.getItem(key) || "";
        found.push({ key, novelId, parentId, preview: content.slice(0, 100) });
      }
    }
    setDrafts(found);
  }, []);

  function deleteDraft(key: string) {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    localStorage.removeItem(key);
    setDrafts(prev => prev.filter(d => d.key !== key));
  }

  if (drafts.length === 0) {
    return <p className="text-caption on-empty">No drafts saved.</p>;
  }

  return (
    <div className="on-stack on-stack-sm" style={{ marginTop: "0.75rem" }}>
      {drafts.map(d => (
        <div key={d.key} className="on-card on-row-between" style={{ padding: "0.75rem 1rem" }}>
          <div className="on-flex-1">
            <span style={{ fontWeight: 600 }}>Novel #{d.novelId} → Parent #{d.parentId}</span>
            <p className="text-tiny text-truncate" style={{ marginTop: "0.25rem" }}>{d.preview}...</p>
          </div>
          <button onClick={() => deleteDraft(d.key)}
            className="on-btn on-btn-ghost" style={{ color: "var(--color-danger)" }}>
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
