"use client";

import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { shortenAddress, formatEth, timeAgo } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface UserChapter {
  id: string;
  novel_id: string;
  chapter_index: number;
  round: number;
  epoch: number;
  vote_count: string;
  is_world_line: boolean;
  is_canon: boolean;
  created_at: string;
  novel_title: string;
}

interface UserVote {
  novel_id: string;
  voting_round_id: string;
  voter: string;
  revealed: boolean;
  candidate_id: string | null;
  claimed: boolean;
  commit_block: string;
  novel_title: string;
}

interface UserNFT {
  token_id: string;
  novel_id: string;
  chapter_id: string;
  epoch: number;
  novel_title: string;
}

interface RewardSummary {
  unclaimedVotes: { novel_id: string; voting_round_id: string; novel_title: string }[];
  stakeEvents: { novel_id: string; event_type: string; total_amount: string; novel_title: string }[];
  rewardClaims: { novel_id: string; source: string; total_amount: string; novel_title: string }[];
  participatedNovelIds: string[];
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [chapters, setChapters] = useState<UserChapter[]>([]);
  const [votes, setVotes] = useState<UserVote[]>([]);
  const [nfts, setNfts] = useState<UserNFT[]>([]);
  const [rewards, setRewards] = useState<RewardSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/users/${address}/chapters`).then(r => r.json()).catch(() => ({ chapters: [] })),
      fetch(`${API_BASE}/api/users/${address}/votes`).then(r => r.json()).catch(() => ({ votes: [] })),
      fetch(`${API_BASE}/api/users/${address}/nfts`).then(r => r.json()).catch(() => ({ nfts: [] })),
      fetch(`${API_BASE}/api/users/${address}/rewards`).then(r => r.json()).catch(() => null),
    ]).then(([chData, voteData, nftData, rewardData]) => {
      setChapters(chData.chapters || []);
      setVotes(voteData.votes || []);
      setNfts(nftData.nfts || []);
      setRewards(rewardData);
      setLoading(false);
    });
  }, [address]);

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">My Dashboard</h1>
        <p className="text-neutral-400 mb-6">Connect your wallet to view your activity.</p>
        <ConnectButton />
      </div>
    );
  }

  const pendingReveals = votes.filter(v => !v.revealed && !v.claimed);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-24 md:pb-8">
      <h1 className="text-2xl font-bold mb-1">My Dashboard</h1>
      <p className="text-neutral-400 text-sm mb-6">{shortenAddress(address!)}</p>

      {/* Urgent: pending reveals */}
      {pendingReveals.length > 0 && (
        <div className="rounded-lg bg-amber-950/30 border border-amber-700 p-4 mb-6">
          <h2 className="font-semibold text-amber-400 mb-2">Action Required: Reveal Your Votes</h2>
          <p className="text-sm text-neutral-300 mb-2">
            You have {pendingReveals.length} vote(s) waiting to be revealed. Unrevealed votes will be forfeited.
          </p>
          {pendingReveals.map(v => (
            <Link key={`${v.novel_id}-${v.voting_round_id}`} href={`/novels/${v.novel_id}`} className="block text-sm text-blue-400 hover:underline">
              {v.novel_title || `Novel #${v.novel_id}`}
            </Link>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">Loading...</p>
      ) : (
        <Tabs defaultValue="chapters">
          <TabsList className="bg-neutral-900 border border-neutral-800">
            <TabsTrigger value="chapters" className="text-xs data-[state=active]:bg-neutral-700">
              My Chapters ({chapters.length})
            </TabsTrigger>
            <TabsTrigger value="votes" className="text-xs data-[state=active]:bg-neutral-700">
              My Votes ({votes.length})
            </TabsTrigger>
            <TabsTrigger value="nfts" className="text-xs data-[state=active]:bg-neutral-700">
              My NFTs ({nfts.length})
            </TabsTrigger>
            <TabsTrigger value="rewards" className="text-xs data-[state=active]:bg-neutral-700">
              Rewards
            </TabsTrigger>
            <TabsTrigger value="drafts" className="text-xs data-[state=active]:bg-neutral-700">
              Drafts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chapters" className="mt-4">
            {chapters.length === 0 ? (
              <p className="text-neutral-500 text-sm">No chapters submitted yet.</p>
            ) : (
              <div className="space-y-2">
                {chapters.map(ch => (
                  <Link key={ch.id} href={`/chapters/${ch.id}`} className="flex items-center justify-between rounded-md bg-neutral-900 border border-neutral-800 p-3 hover:border-neutral-600 text-sm">
                    <div>
                      <span className="font-medium">{ch.novel_title || `Novel #${ch.novel_id}`}</span>
                      <span className="text-neutral-500 ml-2">Chapter #{ch.id} (index {ch.chapter_index})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-500">{ch.vote_count} votes</span>
                      {ch.is_canon && <Badge className="bg-amber-600 text-xs">Canon</Badge>}
                      {ch.is_world_line && !ch.is_canon && <Badge className="bg-green-700 text-xs">WL</Badge>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="votes" className="mt-4">
            {votes.length === 0 ? (
              <p className="text-neutral-500 text-sm">No votes cast yet.</p>
            ) : (
              <div className="space-y-2">
                {votes.map((v, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md bg-neutral-900 border border-neutral-800 p-3 text-sm">
                    <div>
                      <Link href={`/novels/${v.novel_id}`} className="font-medium hover:text-white">
                        {v.novel_title || `Novel #${v.novel_id}`}
                      </Link>
                      {v.candidate_id && <span className="text-neutral-500 ml-2">→ Chapter #{v.candidate_id}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {!v.revealed && <Badge variant="destructive" className="text-xs">Unrevealed</Badge>}
                      {v.revealed && !v.claimed && <Badge className="bg-green-700 text-xs">Claimable</Badge>}
                      {v.claimed && <Badge variant="secondary" className="text-xs">Claimed</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="nfts" className="mt-4">
            {nfts.length === 0 ? (
              <p className="text-neutral-500 text-sm">No NFTs minted yet. Canon chapter authors receive NFTs.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {nfts.map(nft => (
                  <div key={nft.token_id} className="rounded-lg bg-neutral-900 border border-amber-700 p-4">
                    <p className="text-amber-400 font-semibold">Token #{nft.token_id}</p>
                    <p className="text-sm text-neutral-400">
                      {nft.novel_title || `Novel #${nft.novel_id}`} · Chapter #{nft.chapter_id} · Epoch {nft.epoch}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rewards" className="mt-4">
            {!rewards ? (
              <p className="text-neutral-500 text-sm">Loading rewards...</p>
            ) : (
              <div className="space-y-4">
                {rewards.unclaimedVotes.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Unclaimed Voting Rewards</h3>
                    {rewards.unclaimedVotes.map((v, i) => (
                      <Link key={i} href={`/novels/${v.novel_id}`} className="block text-sm text-blue-400 hover:underline">
                        {v.novel_title || `Novel #${v.novel_id}`} — Claim on novel page
                      </Link>
                    ))}
                  </div>
                )}

                {rewards.stakeEvents.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Stake History</h3>
                    {rewards.stakeEvents.map((se, i) => (
                      <div key={i} className="text-sm flex justify-between">
                        <span>{se.novel_title || `Novel #${se.novel_id}`} — {se.event_type}</span>
                        <span className={se.event_type === "refunded" ? "text-green-400" : "text-red-400"}>
                          {formatEth(se.total_amount)} ETH
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {rewards.rewardClaims.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Claimed Rewards</h3>
                    {rewards.rewardClaims.map((rc, i) => (
                      <div key={i} className="text-sm flex justify-between">
                        <span>{rc.novel_title || `Novel #${rc.novel_id}`} — {rc.source}</span>
                        <span className="text-green-400">{formatEth(rc.total_amount)} ETH</span>
                      </div>
                    ))}
                  </div>
                )}

                {rewards.unclaimedVotes.length === 0 && rewards.stakeEvents.length === 0 && rewards.rewardClaims.length === 0 && (
                  <p className="text-neutral-500 text-sm">No reward activity yet.</p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="drafts" className="mt-4">
            <DraftsTab />
          </TabsContent>
        </Tabs>
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
    return <p className="text-neutral-500 text-sm">No drafts saved.</p>;
  }

  return (
    <div className="space-y-2">
      {drafts.map(d => (
        <div key={d.key} className="flex items-center justify-between rounded-md bg-neutral-900 border border-neutral-800 p-3 text-sm">
          <div className="min-w-0 flex-1">
            <Link href={`/write/${d.novelId}/${d.parentId}`} className="font-medium hover:text-white">
              Novel #{d.novelId} → Parent #{d.parentId}
            </Link>
            <p className="text-neutral-500 text-xs truncate mt-0.5">{d.preview}...</p>
          </div>
          <div className="flex gap-2 ml-2">
            <Link href={`/write/${d.novelId}/${d.parentId}`} className="text-blue-400 text-xs hover:underline">Edit</Link>
            <button onClick={() => deleteDraft(d.key)} className="text-red-400 text-xs hover:underline">Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
