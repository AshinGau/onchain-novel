"use client";

import { parseEther, keccak256, encodePacked } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { VOTING_ENGINE_ADDRESS, votingEngineAbi } from "@/lib/contracts";
import { toBytes32Salt } from "@/lib/vote-storage";
import { useTxAction } from "@/hooks/use-tx-action";

interface UseVoteOptions {
  novelId: string;
  votingRoundId: string;
  onCommitSuccess?: () => void;
  onRevealSuccess?: () => void;
}

export function useVote({ novelId, votingRoundId, onCommitSuccess, onRevealSuccess }: UseVoteOptions) {
  const { isConnected, address } = useAccount();

  const { data: onChainCommit, refetch } = useReadContract({
    address: VOTING_ENGINE_ADDRESS,
    abi: votingEngineAbi,
    functionName: "getVoteCommit",
    args: address ? [BigInt(novelId), BigInt(votingRoundId), address] : undefined,
    query: { enabled: !!address },
  });

  const onChainCommitHash = (onChainCommit as any)?.commitHash as string | undefined;
  const onChainRevealed = !!(onChainCommit as any)?.revealed;
  const alreadyCommitted = !!onChainCommitHash && onChainCommitHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  const commitTx = useTxAction({
    onSuccess: () => { onCommitSuccess?.(); refetch(); },
  });

  const revealTx = useTxAction({
    onSuccess: () => { onRevealSuccess?.(); refetch(); },
  });

  function commit(candidateId: string, userSalt: string, stakeAmount: string) {
    const bytes32 = toBytes32Salt(userSalt);
    const commitHash = keccak256(encodePacked(["uint256", "bytes32"], [BigInt(candidateId), bytes32]));
    commitTx.writeContract({
      address: VOTING_ENGINE_ADDRESS,
      abi: votingEngineAbi,
      functionName: "commitVote",
      args: [BigInt(novelId), BigInt(votingRoundId), commitHash],
      value: parseEther(stakeAmount),
    });
  }

  function reveal(candidateId: string, salt: string) {
    const bytes32 = toBytes32Salt(salt);
    revealTx.writeContract({
      address: VOTING_ENGINE_ADDRESS,
      abi: votingEngineAbi,
      functionName: "revealVote",
      args: [BigInt(novelId), BigInt(votingRoundId), BigInt(candidateId), bytes32],
    });
  }

  return {
    isConnected,
    address,
    alreadyCommitted,
    onChainRevealed,
    commitTx,
    revealTx,
    commit,
    reveal,
    refetch,
  };
}
