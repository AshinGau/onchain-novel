"use client";

import { useState, useCallback } from "react";
import { TOKEN_SYMBOL } from "@/lib/config";
import { type NovelConfigForm, CONTENT_LOCATIONS, validateField } from "@/lib/novel-config";
import { DurationInput } from "@/components/duration-input";
import { PercentSlider, RawPercentSlider } from "@/components/percent-slider";
import { FieldTooltip } from "@/components/field-tooltip";

// ── Shared styles ──
const inputBase =
  "w-full rounded-lg bg-neutral-900 border px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-500";
const labelClass = "block text-sm font-medium text-neutral-300 mb-1";
const hintClass = "text-xs text-neutral-500 mt-1";

// ── Reusable form primitives ──

function NumberField({ label, tip, value, onChange, onBlur, error, min }: {
  label: string; tip: string; value: number;
  onChange: (v: number) => void; onBlur: () => void;
  error?: string; min?: number;
}) {
  return (
    <div>
      <label className={labelClass}>{label} <FieldTooltip content={tip} /></label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min ?? 0, Number(e.target.value)))}
        onBlur={onBlur}
        min={min ?? 0}
        className={`${inputBase} ${error ? "border-red-600" : "border-neutral-700"}`}
      />
      {error ? <p className="text-xs text-red-400 mt-1">{error}</p> : null}
    </div>
  );
}

function DurationField({ label, tip, value, onChange, error }: {
  label: string; tip: string; value: number;
  onChange: (v: number) => void; error?: string;
}) {
  return (
    <div>
      <label className={labelClass}>{label} <FieldTooltip content={tip} /></label>
      <DurationInput value={value} onChange={onChange} />
      {error ? <p className="text-xs text-red-400 mt-1">{error}</p> : null}
    </div>
  );
}

// ── Main ConfigForm ──

interface ConfigFormProps {
  config: NovelConfigForm;
  onChange: (config: NovelConfigForm) => void;
  /** If true, contentLocation is read-only (fork mode) */
  contentLocationReadOnly?: boolean;
}

export function ConfigForm({ config, onChange, contentLocationReadOnly }: ConfigFormProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = useCallback(<K extends keyof NovelConfigForm>(key: K, value: NovelConfigForm[K]) => {
    onChange({ ...config, [key]: value });
  }, [config, onChange]);

  const blur = useCallback((field: keyof NovelConfigForm) => {
    const delta = validateField(config, field);
    setErrors((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(delta)) {
        if (v) next[k] = v; else delete next[k];
      }
      return next;
    });
  }, [config]);

  const selectedLoc = CONTENT_LOCATIONS.find((l) => l.value === config.contentLocation);

  return (
    <div className="space-y-6">
      {/* Chapter */}
      <Section title="Chapter">
        <Grid>
          <NumberField label="Min Chapter Length (bytes)" tip="Minimum content size in bytes. CJK characters are ~3 bytes each."
            value={config.minChapterLength} onChange={(v) => update("minChapterLength", v)} onBlur={() => blur("minChapterLength")} error={errors.minChapterLength} min={1} />
          <NumberField label="Max Chapter Length (bytes)" tip="Maximum content size in bytes. Limits gas costs and keeps chapters readable."
            value={config.maxChapterLength} onChange={(v) => update("maxChapterLength", v)} onBlur={() => blur("maxChapterLength")} error={errors.maxChapterLength} min={1} />
        </Grid>
      </Section>

      {/* Rounds */}
      <Section title="Rounds">
        <Grid>
          <DurationField label="Round Min Duration" tip="Minimum time the submission phase must last before it can close."
            value={config.roundMinDuration} onChange={(v) => update("roundMinDuration", v)} error={errors.roundMinDuration} />
          <NumberField label="Min Submissions per Round" tip="Minimum chapter submissions required before voting. Must be >= World Line Count."
            value={config.roundMinSubmissions} onChange={(v) => update("roundMinSubmissions", v)} onBlur={() => blur("roundMinSubmissions")} error={errors.roundMinSubmissions} min={1} />
          <NumberField label="World Line Count" tip="Parallel story branches kept each round. Top N voted chapters become world lines."
            value={config.worldLineCount} onChange={(v) => update("worldLineCount", v)} onBlur={() => blur("worldLineCount")} error={errors.worldLineCount} min={1} />
          <NumberField label="Rounds per Epoch" tip="Rounds before Epoch voting. At epoch end, one world line is elected as Canon."
            value={config.roundsPerEpoch} onChange={(v) => update("roundsPerEpoch", v)} onBlur={() => blur("roundsPerEpoch")} error={errors.roundsPerEpoch} min={1} />
        </Grid>
      </Section>

      {/* Voting */}
      <Section title="Voting">
        <Grid>
          <DurationField label="Commit Duration" tip="Time for voters to submit encrypted vote commitments."
            value={config.commitDuration} onChange={(v) => update("commitDuration", v)} error={errors.commitDuration} />
          <DurationField label="Reveal Duration" tip="Time for voters to reveal votes. Unrevealed votes are confiscated."
            value={config.revealDuration} onChange={(v) => update("revealDuration", v)} error={errors.revealDuration} />
        </Grid>
      </Section>

      {/* Economics */}
      <Section title="Economics">
        <Grid>
          <div>
            <label className={labelClass}>Stake Amount ({TOKEN_SYMBOL}) <FieldTooltip content={`Anti-spam deposit. Normal losers get full refund; only spam-flagged authors lose 50%.`} /></label>
            <input
              type="text"
              value={config.stakeAmount}
              onChange={(e) => update("stakeAmount", e.target.value)}
              onBlur={() => blur("stakeAmount")}
              className={`${inputBase} ${errors.stakeAmount ? "border-red-600" : "border-neutral-700"}`}
            />
            {errors.stakeAmount && <p className="text-xs text-red-400 mt-1">{errors.stakeAmount}</p>}
          </div>
          <div>{/* spacer for grid alignment */}</div>
          <div>
            <label className={labelClass}>Prize Release Rate <FieldTooltip content="Percentage of the prize pool released each Epoch. Split into: creator royalty (decays over time) → author rewards → voter rewards." /></label>
            <PercentSlider value={config.prizeReleaseRate} onChange={(v) => update("prizeReleaseRate", v)} max={5000} step={100} />
          </div>
          <div>
            <label className={labelClass}>Voter Reward Rate <FieldTooltip content="Share of epoch rewards for voters. Higher = more voter incentive, less for authors. Accurate voters get 3x weight." /></label>
            <PercentSlider value={config.voterRewardRate} onChange={(v) => update("voterRewardRate", v)} max={2000} step={100} />
          </div>
        </Grid>
      </Section>

      {/* Anti-Spam */}
      <Section title="Anti-Spam">
        <Grid>
          <NumberField label="Strikes Before Slash" tip="Consecutive rounds in the bottom tier before 50% stake slash. Resets if the author skips a round or ranks higher."
            value={config.spamRounds} onChange={(v) => update("spamRounds", v)} onBlur={() => blur("spamRounds")} error={errors.spamRounds} min={1} />
          <div>
            <label className={labelClass}>Bottom Tier <FieldTooltip content="Authors ranking in the lowest X% each round receive a strike. Only tracked when 10+ submissions." /></label>
            <RawPercentSlider value={config.spamThreshold} onChange={(v) => update("spamThreshold", v)} min={5} max={50} step={5} />
          </div>
        </Grid>
      </Section>

      {/* Rules (AI Agents) */}
      <Section title="Rules (AI Agents)">
        <p className="text-xs text-neutral-500 mb-3">Configure how world-building rules are proposed and approved. Rules help collaborating AI agents maintain narrative consistency.</p>
        <Grid>
          <div>
            <label className={labelClass}>Rule Proposal Fee ({TOKEN_SYMBOL}) <FieldTooltip content="Fee to propose a rule (goes to prize pool). Set to 0 for free proposals." /></label>
            <input
              type="text"
              value={config.ruleFee}
              onChange={(e) => update("ruleFee", e.target.value)}
              onBlur={() => blur("ruleFee")}
              className={`${inputBase} ${errors.ruleFee ? "border-red-600" : "border-neutral-700"}`}
            />
            {errors.ruleFee && <p className="text-xs text-red-400 mt-1">{errors.ruleFee}</p>}
          </div>
          <NumberField label="Rule Vote Quorum" tip="Number of canon-author votes needed to approve a rule proposal."
            value={config.ruleQuorum} onChange={(v) => update("ruleQuorum", v)} onBlur={() => blur("ruleQuorum")} error={errors.ruleQuorum} min={0} />
          <DurationField label="Rule Vote Duration" tip="Time window for canon authors to vote on a rule proposal."
            value={config.ruleVoteDuration} onChange={(v) => update("ruleVoteDuration", v)} error={errors.ruleVoteDuration} />
        </Grid>
      </Section>

      {/* Content Storage */}
      <Section title="Content Storage">
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Content Location <FieldTooltip content="Where chapter text is stored. Immutable after creation." /></label>
            {contentLocationReadOnly ? (
              <p className="text-sm text-neutral-300 mt-1">{selectedLoc?.label ?? "Unknown"} — {selectedLoc?.desc}</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mt-1">
                  {CONTENT_LOCATIONS.map((loc) => (
                    <button
                      key={loc.value}
                      type="button"
                      onClick={() => { update("contentLocation", loc.value); blur("contentBaseUrl"); }}
                      className={`rounded-lg border px-4 py-1.5 text-sm transition-colors ${
                        config.contentLocation === loc.value
                          ? "border-white bg-white text-black font-medium"
                          : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500"
                      }`}
                    >
                      {loc.label}
                    </button>
                  ))}
                </div>
                {selectedLoc && <p className={hintClass}>{selectedLoc.desc}</p>}
              </>
            )}
          </div>
          {config.contentLocation !== 0 && (
            <div>
              <label className={labelClass}>Content Base URL</label>
              <input
                type="text"
                value={config.contentBaseUrl}
                onChange={(e) => update("contentBaseUrl", e.target.value)}
                onBlur={() => blur("contentBaseUrl")}
                placeholder="https://..."
                className={`${inputBase} ${errors.contentBaseUrl ? "border-red-600" : "border-neutral-700"}`}
              />
              {errors.contentBaseUrl && <p className="text-xs text-red-400 mt-1">{errors.contentBaseUrl}</p>}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

// ── Layout helpers ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-neutral-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}

// Re-export styles for pages that need them (metadata section, etc.)
export { inputBase, labelClass, hintClass };
