export interface NovelConfigForm {
  minChapterLength: number;
  maxChapterLength: number;
  roundMinDuration: number;
  roundMinSubmissions: number;
  worldLineCount: number;
  roundsPerEpoch: number;
  commitDuration: number;
  revealDuration: number;
  stakeAmount: string;
  prizeReleaseRate: number;
  voterRewardRate: number;
  spamRounds: number;
  spamThreshold: number;
  contentLocation: number;
  contentBaseUrl: string;
  ruleFee: string;
  ruleVoteDuration: number;
  ruleQuorum: number;
}

export const DEFAULT_CONFIG: NovelConfigForm = {
  minChapterLength: 500,
  maxChapterLength: 50000,
  roundMinDuration: 86400,
  roundMinSubmissions: 3,
  worldLineCount: 2,
  roundsPerEpoch: 3,
  commitDuration: 259200,
  revealDuration: 172800,
  stakeAmount: "0.01",
  prizeReleaseRate: 3000,
  voterRewardRate: 1000,
  spamRounds: 3,
  spamThreshold: 20,
  contentLocation: 0,
  contentBaseUrl: "",
  ruleFee: "0.001",
  ruleVoteDuration: 259200,
  ruleQuorum: 7,
};

export const CONTENT_LOCATIONS = [
  { value: 0, label: "Onchain", desc: "Stored in transaction calldata. Cheapest on L2, zero external dependencies." },
  { value: 1, label: "External", desc: "Stored on IPFS/Arweave. Chain only stores content hash." },
  { value: 2, label: "HTTP", desc: "Stored on HTTP server (S3/CDN). Chain only stores content hash." },
] as const;

/** Validation rules matching the contract's _validateConfig */
interface Rule {
  check: (c: NovelConfigForm) => boolean;
  msg: string;
  /** Other fields to re-validate when this one changes */
  revalidate?: (keyof NovelConfigForm)[];
}

const FIELD_RULES: Partial<Record<keyof NovelConfigForm, Rule>> = {
  minChapterLength:    { check: (c) => c.minChapterLength > 0, msg: "Must be > 0" },
  maxChapterLength:    { check: (c) => c.maxChapterLength > c.minChapterLength, msg: "Must be > Min Chapter Length" },
  roundMinDuration:    { check: (c) => c.roundMinDuration > 0, msg: "Must be > 0" },
  worldLineCount:      { check: (c) => c.worldLineCount > 0, msg: "Must be > 0", revalidate: ["roundMinSubmissions"] },
  roundMinSubmissions: { check: (c) => c.roundMinSubmissions >= c.worldLineCount, msg: "Must be >= World Line Count" },
  roundsPerEpoch:      { check: (c) => c.roundsPerEpoch > 0, msg: "Must be > 0" },
  commitDuration:      { check: (c) => c.commitDuration > 0, msg: "Must be > 0" },
  revealDuration:      { check: (c) => c.revealDuration > 0, msg: "Must be > 0" },
  stakeAmount:         { check: (c) => !!c.stakeAmount && parseFloat(c.stakeAmount) > 0, msg: "Must be > 0" },
  spamRounds:     { check: (c) => c.spamRounds > 0, msg: "Must be > 0" },
  spamThreshold:  { check: (c) => c.spamThreshold > 0 && c.spamThreshold <= 100, msg: "Must be 1–100%" },
  ruleFee:         { check: (c) => !!c.ruleFee && parseFloat(c.ruleFee) >= 0, msg: "Must be >= 0" },
  ruleVoteDuration: { check: (c) => c.ruleQuorum === 0 || c.ruleVoteDuration > 0, msg: "Must be > 0 when quorum > 0" },
  ruleQuorum:      { check: (c) => c.ruleQuorum >= 0, msg: "Must be >= 0" },
  contentBaseUrl:      { check: (c) => c.contentLocation === 0 || c.contentBaseUrl.trim().length > 0, msg: "Required for External/HTTP" },
};

/** Validate a single field. Returns error map delta (field→msg or field→null to clear). */
export function validateField(config: NovelConfigForm, field: keyof NovelConfigForm): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  const rule = FIELD_RULES[field];
  if (rule) {
    result[field] = rule.check(config) ? null : rule.msg;
    // re-validate dependent fields
    for (const dep of rule.revalidate ?? []) {
      const depRule = FIELD_RULES[dep];
      if (depRule) result[dep] = depRule.check(config) ? null : depRule.msg;
    }
  }
  return result;
}

/** Validate all fields. Returns first error message or null. */
export function validateAllFields(config: NovelConfigForm): string | null {
  for (const [field, rule] of Object.entries(FIELD_RULES)) {
    if (rule && !rule.check(config)) {
      return `${fieldLabel(field as keyof NovelConfigForm)}: ${rule.msg}`;
    }
  }
  return null;
}

function fieldLabel(f: keyof NovelConfigForm): string {
  const labels: Partial<Record<keyof NovelConfigForm, string>> = {
    minChapterLength: "Min Chapter Length",
    maxChapterLength: "Max Chapter Length",
    roundMinDuration: "Round Min Duration",
    roundMinSubmissions: "Min Submissions",
    worldLineCount: "World Line Count",
    roundsPerEpoch: "Rounds per Epoch",
    commitDuration: "Commit Duration",
    revealDuration: "Reveal Duration",
    stakeAmount: "Stake Amount",
    spamRounds: "Strikes Before Slash",
    spamThreshold: "Bottom Tier",
    contentBaseUrl: "Content Base URL",
    ruleFee: "Rule Proposal Fee",
    ruleVoteDuration: "Rule Vote Duration",
    ruleQuorum: "Rule Vote Quorum",
  };
  return labels[f] ?? f;
}
