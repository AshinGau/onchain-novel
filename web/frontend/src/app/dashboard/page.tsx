"use client";

import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState, useEffect } from "react";
import Link from "next/link";
import { TOKEN_SYMBOL } from "@/lib/config";
import { API_BASE } from "@/lib/api";
import { shortenAddress, formatEth, timeAgo } from "@/lib/format";
import { RewardsPanel } from "@/components/rewards-panel";

interface UserChapter { id: string; novel_id: string; chapter_index: number; round: number; epoch: number; vote_count: string; is_world_line: boolean; is_canon: boolean; created_at: string; novel_title: string; }
interface UserVote { novel_id: string; voting_round_id: string; voter: string; revealed: boolean; candidate_id: string | null; claimed: boolean; commit_block: string; novel_title: string; }
interface UserNFT { token_id: string; novel_id: string; chapter_id: string; epoch: number; novel_title: string; }
interface RewardSummary { unclaimedVotes: { novel_id: string; voting_round_id: string; novel_title: string }[]; stakeEvents: { novel_id: string; event_type: string; total_amount: string; novel_title: string }[]; rewardClaims: { novel_id: string; source: string; total_amount: string; novel_title: string }[]; participatedNovels: { novel_id: string; novel_title: string }[]; }

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [chapters, setChapters] = useState<UserChapter[]>([]);
  const [votes, setVotes] = useState<UserVote[]>([]);
  const [nfts, setNfts] = useState<UserNFT[]>([]);
  const [rewards, setRewards] = useState<RewardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("chapters");

  useEffect(() => {
    if (!address) return; setLoading(true); setFetchError(null);
    Promise.all([
      fetch(`${API_BASE}/api/users/${address}/chapters`).then(r => { if (!r.ok) throw new Error("chapters"); return r.json(); }),
      fetch(`${API_BASE}/api/users/${address}/votes`).then(r => { if (!r.ok) throw new Error("votes"); return r.json(); }),
      fetch(`${API_BASE}/api/users/${address}/nfts`).then(r => { if (!r.ok) throw new Error("nfts"); return r.json(); }),
      fetch(`${API_BASE}/api/users/${address}/rewards`).then(r => { if (!r.ok) throw new Error("rewards"); return r.json(); }),
    ]).then(([chData, voteData, nftData, rewardData]) => {
      setChapters(chData.chapters || []); setVotes(voteData.votes || []); setNfts(nftData.nfts || []); setRewards(rewardData);
    }).catch((err) => setFetchError(`Failed to load dashboard data: ${err.message}`)).finally(() => setLoading(false));
  }, [address]);

  if (!isConnected) return (
    <div className="container py-5 text-center" style={{ maxWidth: 720 }}>
      <h2 className="fw-bold mb-3">My Dashboard</h2>
      <p className="text-body-secondary mb-4">Connect your wallet to view your activity.</p>
      <ConnectButton />
    </div>
  );

  const pendingReveals = votes.filter(v => !v.revealed && !v.claimed);
  const tabs = [
    { key: "chapters", label: `My Chapters (${chapters.length})` },
    { key: "votes", label: `My Votes (${votes.length})` },
    { key: "nfts", label: `My NFTs (${nfts.length})` },
    { key: "rewards", label: `Rewards (${rewards?.participatedNovels.length ?? 0})` },
    { key: "drafts", label: "Drafts" },
  ];

  return (
    <div className="container-lg py-4 pb-5">
      <h2 className="fw-bold mb-1">My Dashboard</h2>
      <p className="text-body-secondary small mb-4">{shortenAddress(address!)}</p>

      {fetchError && <div className="alert alert-danger small">{fetchError}</div>}

      {pendingReveals.length > 0 && (
        <div className="alert alert-warning mb-3">
          <h6 className="alert-heading">Action Required: Reveal Your Votes</h6>
          <p className="small mb-1">You have {pendingReveals.length} vote(s) waiting to be revealed. Unrevealed votes will be forfeited.</p>
          {pendingReveals.map(v => <Link key={`${v.novel_id}-${v.voting_round_id}`} href={`/novels/${v.novel_id}`} className="d-block small link-primary">{v.novel_title || `Novel #${v.novel_id}`}</Link>)}
        </div>
      )}

      {loading ? <p className="text-body-tertiary">Loading...</p> : (
        <>
          <ul className="nav nav-tabs mb-3">
            {tabs.map(t => (
              <li className="nav-item" key={t.key}>
                <button className={`nav-link ${activeTab === t.key ? "active" : ""}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
              </li>
            ))}
          </ul>

          {activeTab === "chapters" && (
            chapters.length === 0 ? <p className="text-body-tertiary small">No chapters submitted yet.</p> : (
              <div className="list-group">{chapters.map(ch => (
                <Link key={ch.id} href={`/chapters/${ch.id}`} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center small">
                  <div><strong>{ch.novel_title || `Novel #${ch.novel_id}`}</strong> <span className="text-body-secondary">Candidate(ID.{ch.id}) · Chapter #{ch.chapter_index}</span></div>
                  <div className="d-flex align-items-center gap-2">
                    <span className="text-body-secondary">{ch.vote_count} votes</span>
                    {ch.is_canon && <span className="badge bg-warning text-dark">Canon</span>}
                    {ch.is_world_line && !ch.is_canon && <span className="badge bg-success">WL</span>}
                  </div>
                </Link>
              ))}</div>
            )
          )}

          {activeTab === "votes" && (
            votes.length === 0 ? <p className="text-body-tertiary small">No votes cast yet.</p> : (
              <div className="list-group">{votes.map((v, i) => (
                <div key={i} className="list-group-item d-flex justify-content-between align-items-center small">
                  <div><Link href={`/novels/${v.novel_id}`} className="fw-medium text-decoration-none">{v.novel_title || `Novel #${v.novel_id}`}</Link>
                    {v.candidate_id && <span className="text-body-secondary ms-2">→ Candidate(ID.{v.candidate_id})</span>}</div>
                  <div>{!v.revealed && <span className="badge bg-danger">Unrevealed</span>}
                    {v.revealed && !v.claimed && <span className="badge bg-success">Claimable</span>}
                    {v.claimed && <span className="badge bg-secondary">Claimed</span>}</div>
                </div>
              ))}</div>
            )
          )}

          {activeTab === "nfts" && (
            nfts.length === 0 ? <p className="text-body-tertiary small">No NFTs minted yet. Canon chapter authors receive NFTs.</p> : (
              <div className="row row-cols-1 row-cols-sm-2 g-3">{nfts.map(nft => (
                <div className="col" key={nft.token_id}><div className="card border-warning"><div className="card-body">
                  <p className="text-warning fw-semibold mb-1">Token #{nft.token_id}</p>
                  <p className="small text-body-secondary mb-0">{nft.novel_title || `Novel #${nft.novel_id}`} · Candidate(ID.{nft.chapter_id}) · Epoch {nft.epoch}</p>
                </div></div></div>
              ))}</div>
            )
          )}

          {activeTab === "rewards" && (
            !rewards ? <p className="text-body-tertiary small">Loading rewards...</p> : (
              <div className="d-flex flex-column gap-3">
                {rewards.participatedNovels.length > 0 ? (
                  <>
                    <p className="small text-body-secondary">Showing claimable rewards for each novel you participated in.</p>
                    {rewards.participatedNovels.map(pn => (
                      <div key={pn.novel_id}>
                        <Link href={`/novels/${pn.novel_id}`} className="small fw-medium link-primary">{pn.novel_title || `Novel #${pn.novel_id}`}</Link>
                        <RewardsPanel novelId={pn.novel_id} />
                      </div>
                    ))}
                  </>
                ) : <p className="text-body-tertiary small">No reward activity yet.</p>}

                {(rewards.stakeEvents.length > 0 || rewards.rewardClaims.length > 0) && (
                  <details className="card"><summary className="card-header small" role="button">History ({rewards.stakeEvents.length + rewards.rewardClaims.length} events)</summary>
                    <div className="card-body small">
                      {rewards.stakeEvents.length > 0 && <div className="mb-2"><strong>Stake Events</strong>{rewards.stakeEvents.map((se, i) => (
                        <div key={i} className="d-flex justify-content-between"><span>{se.novel_title || `Novel #${se.novel_id}`} — {se.event_type}</span><span className={se.event_type === "refunded" ? "text-success" : "text-danger"}>{formatEth(se.total_amount)} {TOKEN_SYMBOL}</span></div>
                      ))}</div>}
                      {rewards.rewardClaims.length > 0 && <div><strong>Claimed Rewards</strong>{rewards.rewardClaims.map((rc, i) => (
                        <div key={i} className="d-flex justify-content-between"><span>{rc.novel_title || `Novel #${rc.novel_id}`} — {rc.source}</span><span className="text-success">{formatEth(rc.total_amount)} {TOKEN_SYMBOL}</span></div>
                      ))}</div>}
                    </div>
                  </details>
                )}
              </div>
            )
          )}

          {activeTab === "drafts" && <DraftsTab />}
        </>
      )}
    </div>
  );
}

function DraftsTab() {
  const [drafts, setDrafts] = useState<{ key: string; novelId: string; parentId: string; preview: string }[]>([]);

  useEffect(() => {
    const found: typeof drafts = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("draft:")) { const parts = key.split(":"); found.push({ key, novelId: parts[1], parentId: parts[2], preview: (localStorage.getItem(key) || "").slice(0, 100) }); }
    }
    setDrafts(found);
  }, []);

  function deleteDraft(key: string) {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    localStorage.removeItem(key); setDrafts(prev => prev.filter(d => d.key !== key));
  }

  if (drafts.length === 0) return <p className="text-body-tertiary small">No drafts saved.</p>;

  return (
    <div className="list-group">{drafts.map(d => (
      <div key={d.key} className="list-group-item d-flex justify-content-between align-items-center small">
        <div className="flex-grow-1 min-w-0">
          <Link href={`/write/${d.novelId}/${d.parentId}`} className="fw-medium text-decoration-none">Novel #{d.novelId} → Parent #{d.parentId}</Link>
          <p className="text-body-tertiary small text-truncate mb-0">{d.preview}...</p>
        </div>
        <div className="d-flex gap-2 ms-2 flex-shrink-0">
          <Link href={`/write/${d.novelId}/${d.parentId}`} className="link-primary small">Edit</Link>
          <button onClick={() => deleteDraft(d.key)} className="btn btn-link btn-sm text-danger p-0 small">Delete</button>
        </div>
      </div>
    ))}</div>
  );
}
