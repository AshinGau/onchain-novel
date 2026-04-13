export interface NovelConfigForm {
  minChapterLength: number;
  maxChapterLength: number;
  submissionFee: string;
  worldLineCount: number;
  voteStake: string;
  nominationFee: string;
  nominateDuration: number;
  commitDuration: number;
  revealDuration: number;
  minRoundGap: number;
  prizeReleaseRate: number;
  voterRewardRate: number;
  contentLocation: number;
  contentBaseUrl: string;
  ruleFee: string;
  ruleVoteDuration: number;
  ruleQuorum: number;
}

export const DEFAULT_CONFIG: NovelConfigForm = {
  minChapterLength: 1000,
  maxChapterLength: 50000,
  submissionFee: "0.001",
  worldLineCount: 2,
  voteStake: "0.001",
  nominationFee: "0.1",
  nominateDuration: 86400,
  commitDuration: 259200,
  revealDuration: 172800,
  minRoundGap: 86400,
  prizeReleaseRate: 2000,
  voterRewardRate: 500,
  contentLocation: 0,
  contentBaseUrl: "",
  ruleFee: "0.01",
  ruleVoteDuration: 259200,
  ruleQuorum: 7,
};

export const CONTENT_LOCATIONS = [
  { value: 0, label: "Onchain", desc: "Stored in transaction calldata. Cheapest on L2, zero external dependencies." },
  { value: 1, label: "External", desc: "Stored on IPFS/Arweave. Chain only stores content hash." },
  { value: 2, label: "HTTP", desc: "Stored on HTTP server (S3/CDN). Chain only stores content hash." },
] as const;

interface Rule {
  check: (c: NovelConfigForm) => boolean;
  msg: string;
  revalidate?: (keyof NovelConfigForm)[];
}

const FIELD_RULES: Partial<Record<keyof NovelConfigForm, Rule>> = {
  minChapterLength:    { check: (c) => c.minChapterLength > 0, msg: "Must be > 0" },
  maxChapterLength:    { check: (c) => c.maxChapterLength > c.minChapterLength, msg: "Must be > Min Chapter Length" },
  worldLineCount:      { check: (c) => c.worldLineCount > 0 && c.worldLineCount <= 16, msg: "Must be 1-16", revalidate: [] },
  commitDuration:      { check: (c) => c.commitDuration > 0, msg: "Must be > 0" },
  revealDuration:      { check: (c) => c.revealDuration > 0, msg: "Must be > 0" },
  nominateDuration:    { check: (c) => c.nominateDuration > 0, msg: "Must be > 0" },
  minRoundGap:         { check: (c) => c.minRoundGap > 0, msg: "Must be > 0" },
  submissionFee:       { check: (c) => !!c.submissionFee && parseFloat(c.submissionFee) >= 0.0001, msg: "Must be >= 0.0001" },
  voteStake:           { check: (c) => !!c.voteStake && parseFloat(c.voteStake) > 0 && parseFloat(c.voteStake) <= parseFloat(c.submissionFee || "0"), msg: "Must be > 0 and <= Submission Fee", revalidate: [] },
  nominationFee:       { check: (c) => !!c.nominationFee && parseFloat(c.nominationFee) >= 0, msg: "Must be >= 0" },
  ruleFee:             { check: (c) => !!c.ruleFee && parseFloat(c.ruleFee) >= 0, msg: "Must be >= 0" },
  ruleVoteDuration:    { check: (c) => c.ruleQuorum === 0 || c.ruleVoteDuration > 0, msg: "Must be > 0 when quorum > 0" },
  ruleQuorum:          { check: (c) => c.ruleQuorum >= 0, msg: "Must be >= 0" },
  contentBaseUrl:      { check: (c) => c.contentLocation === 0 || c.contentBaseUrl.trim().length > 0, msg: "Required for External/HTTP" },
};

export function validateField(config: NovelConfigForm, field: keyof NovelConfigForm): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  const rule = FIELD_RULES[field];
  if (rule) {
    result[field] = rule.check(config) ? null : rule.msg;
    for (const dep of rule.revalidate ?? []) {
      const depRule = FIELD_RULES[dep];
      if (depRule) result[dep] = depRule.check(config) ? null : depRule.msg;
    }
  }
  return result;
}

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
    submissionFee: "Submission Fee",
    worldLineCount: "World Line Count",
    voteStake: "Vote Stake",
    nominationFee: "Nomination Fee",
    nominateDuration: "Nominate Duration",
    commitDuration: "Commit Duration",
    revealDuration: "Reveal Duration",
    minRoundGap: "Min Round Gap",
    contentBaseUrl: "Content Base URL",
    ruleFee: "Rule Proposal Fee",
    ruleVoteDuration: "Rule Vote Duration",
    ruleQuorum: "Rule Vote Quorum",
  };
  return labels[f] ?? f;
}
