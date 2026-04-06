import type { PublicClient } from "viem";
import { rulesEngineAbi } from "../abi/index.js";
import { config } from "../config.js";
import { hasApi, apiFetch } from "./api-client.js";

export interface Rule {
  name: string;
  content: string;
}

/**
 * Fetch all rules for a novel. Prefers API, falls back to chain reads.
 */
export async function fetchRules(novelId: number | bigint, publicClient?: PublicClient): Promise<Rule[]> {
  if (hasApi()) {
    return apiFetch<Rule[]>(`/api/novels/${novelId}/rules`);
  }

  if (!publicClient) return [];

  const names = await publicClient.readContract({
    address: config.rulesEngineAddress,
    abi: rulesEngineAbi,
    functionName: "getRuleNames",
    args: [BigInt(novelId)],
  }) as string[];

  if (names.length === 0) return [];

  return Promise.all(
    names.map(async (name) => {
      const content = await publicClient.readContract({
        address: config.rulesEngineAddress,
        abi: rulesEngineAbi,
        functionName: "getRule",
        args: [BigInt(novelId), name],
      }) as string;
      return { name, content };
    })
  );
}

/**
 * Format rules as a context section for writer agents.
 */
export function formatRulesForWriter(rules: Rule[]): string {
  if (rules.length === 0) return "";

  const entries = rules.map((r) => `  [${r.name}]\n  ${r.content}`).join("\n\n");
  return [
    `## Story Bible (${rules.length} entries)`,
    `World-building notes maintained by the creator and canon authors — story background,`,
    `character sketches, plot threads. Use them as creative inspiration, not rigid constraints.`,
    `Different world lines thrive on different interpretations.`,
    ``,
    entries,
  ].join("\n");
}

/**
 * Format rules as a context section for voter agents.
 */
export function formatRulesForVoter(rules: Rule[]): string {
  if (rules.length === 0) return "";

  const entries = rules.map((r) => `  [${r.name}]\n  ${r.content}`).join("\n\n");
  return [
    `## Story Bible (${rules.length} entries)`,
    `These notes describe the story's established world. They may help you understand context,`,
    `but judge chapters on narrative quality, creativity, and coherence — not rule compliance.`,
    ``,
    entries,
  ].join("\n");
}
