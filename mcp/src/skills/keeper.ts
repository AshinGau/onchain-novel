import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/wallet.js";

const ROUND_PHASE_NAMES = ["Submitting", "Committing", "Revealing", "Settling"];
const EPOCH_PHASE_NAMES = ["Rounds", "Committing", "Revealing", "Settling"];

export function registerKeeperSkills(server: McpServer): void {
  server.tool(
    "keeper_check_and_advance",
    "Keeper Skill: Check the current phase of a novel and attempt to advance it if conditions are met. Automatically determines which transition to call based on the current state.",
    {
      novelId: z.number().describe("Novel ID to check and potentially advance"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();
        const walletClient = getWalletClient();

        // Get novel state
        const novel = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getNovel",
          args: [BigInt(params.novelId)],
        })) as {
          id: bigint;
          currentRound: number;
          currentEpoch: number;
          roundPhase: number;
          epochPhase: number;
          phaseStartTime: bigint;
          active: boolean;
          config: {
            roundMinDuration: bigint;
            roundMinSubmissions: number;
            commitDuration: bigint;
            revealDuration: bigint;
            roundsPerEpoch: number;
          };
        };

        if (novel.id === 0n) {
          return {
            content: [
              { type: "text" as const, text: `Novel ${params.novelId} not found.` },
            ],
          };
        }

        if (!novel.active) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Novel #${params.novelId} is not active. No transitions possible.`,
              },
            ],
          };
        }

        const now = BigInt(Math.floor(Date.now() / 1000));
        const phaseElapsed = now - novel.phaseStartTime;

        // Determine current state and action
        const epochPhase = novel.epochPhase; // 0=Rounds, 1=Committing, 2=Revealing, 3=Settling
        const roundPhase = novel.roundPhase; // 0=Submitting, 1=Committing, 2=Revealing, 3=Settling

        let status = [
          `Novel #${params.novelId} Status:`,
          `  Epoch: ${novel.currentEpoch} (${EPOCH_PHASE_NAMES[epochPhase]})`,
          `  Round: ${novel.currentRound} (${ROUND_PHASE_NAMES[roundPhase]})`,
          `  Phase elapsed: ${phaseElapsed}s`,
        ];

        // Epoch-level transitions
        if (epochPhase === 1) {
          // Epoch Committing
          if (phaseElapsed >= novel.config.commitDuration) {
            status.push(`\nEpoch commit duration elapsed. Attempting closeEpochCommit...`);
            try {
              const hash = await walletClient.writeContract({
                address: config.novelCoreAddress,
                abi: novelCoreAbi,
                functionName: "closeEpochCommit",
                args: [BigInt(params.novelId)],
              });
              await publicClient.waitForTransactionReceipt({ hash });
              status.push(`Epoch commit closed. Transaction: ${hash}`);
            } catch (e) {
              status.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          } else {
            const remaining = novel.config.commitDuration - phaseElapsed;
            status.push(`\nEpoch commit phase: ${remaining}s remaining.`);
          }
        } else if (epochPhase === 2) {
          // Epoch Revealing
          if (phaseElapsed >= novel.config.revealDuration) {
            status.push(`\nEpoch reveal duration elapsed. Attempting settleEpoch...`);
            try {
              const hash = await walletClient.writeContract({
                address: config.novelCoreAddress,
                abi: novelCoreAbi,
                functionName: "settleEpoch",
                args: [BigInt(params.novelId)],
              });
              await publicClient.waitForTransactionReceipt({ hash });
              status.push(`Epoch settled. Transaction: ${hash}`);
            } catch (e) {
              status.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          } else {
            const remaining = novel.config.revealDuration - phaseElapsed;
            status.push(`\nEpoch reveal phase: ${remaining}s remaining.`);
          }
        } else if (epochPhase === 0) {
          // In Rounds — handle round-level transitions
          if (roundPhase === 0) {
            // Submitting
            if (phaseElapsed >= novel.config.roundMinDuration) {
              // Check submission count
              const submissions = (await publicClient.readContract({
                address: config.novelCoreAddress,
                abi: novelCoreAbi,
                functionName: "getRoundSubmissions",
                args: [BigInt(params.novelId), novel.currentEpoch, novel.currentRound],
              })) as bigint[];

              if (submissions.length >= novel.config.roundMinSubmissions) {
                status.push(
                  `\nMin duration and submissions (${submissions.length}/${novel.config.roundMinSubmissions}) met. Attempting closeSubmissions...`
                );
                try {
                  const hash = await walletClient.writeContract({
                    address: config.novelCoreAddress,
                    abi: novelCoreAbi,
                    functionName: "closeSubmissions",
                    args: [BigInt(params.novelId)],
                  });
                  await publicClient.waitForTransactionReceipt({ hash });
                  status.push(`Submissions closed. Transaction: ${hash}`);
                } catch (e) {
                  status.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
                }
              } else {
                status.push(
                  `\nMin duration elapsed but only ${submissions.length}/${novel.config.roundMinSubmissions} submissions. Waiting for more.`
                );
              }
            } else {
              const remaining = novel.config.roundMinDuration - phaseElapsed;
              status.push(`\nSubmitting phase: ${remaining}s remaining until min duration.`);
            }
          } else if (roundPhase === 1) {
            // Committing
            if (phaseElapsed >= novel.config.commitDuration) {
              status.push(`\nCommit duration elapsed. Attempting closeCommit...`);
              try {
                const hash = await walletClient.writeContract({
                  address: config.novelCoreAddress,
                  abi: novelCoreAbi,
                  functionName: "closeCommit",
                  args: [BigInt(params.novelId)],
                });
                await publicClient.waitForTransactionReceipt({ hash });
                status.push(`Commit phase closed. Transaction: ${hash}`);
              } catch (e) {
                status.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
              }
            } else {
              const remaining = novel.config.commitDuration - phaseElapsed;
              status.push(`\nCommit phase: ${remaining}s remaining.`);
            }
          } else if (roundPhase === 2) {
            // Revealing
            if (phaseElapsed >= novel.config.revealDuration) {
              status.push(`\nReveal duration elapsed. Attempting settleRound...`);
              try {
                const hash = await walletClient.writeContract({
                  address: config.novelCoreAddress,
                  abi: novelCoreAbi,
                  functionName: "settleRound",
                  args: [BigInt(params.novelId)],
                });
                await publicClient.waitForTransactionReceipt({ hash });
                status.push(`Round settled. Transaction: ${hash}`);
              } catch (e) {
                status.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
              }
            } else {
              const remaining = novel.config.revealDuration - phaseElapsed;
              status.push(`\nReveal phase: ${remaining}s remaining.`);
            }
          } else {
            status.push(`\nRound is in Settling phase. Waiting for settlement to complete.`);
          }
        }

        return { content: [{ type: "text" as const, text: status.join("\n") }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to check/advance: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
