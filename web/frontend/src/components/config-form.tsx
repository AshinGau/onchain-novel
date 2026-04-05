"use client";

import { useState, useCallback } from "react";
import { TOKEN_SYMBOL } from "@/lib/config";
import { type NovelConfigForm, CONTENT_LOCATIONS, validateField } from "@/lib/novel-config";
import { DurationInput } from "@/components/duration-input";
import { PercentSlider, RawPercentSlider } from "@/components/percent-slider";
import { FieldTooltip } from "@/components/field-tooltip";

function NumberField({ label, tip, value, onChange, onBlur, error, min }: {
  label: string; tip: string; value: number;
  onChange: (v: number) => void; onBlur: () => void;
  error?: string; min?: number;
}) {
  return (
    <div>
      <label className="form-label small">{label} <FieldTooltip content={tip} /></label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min ?? 0, Number(e.target.value)))}
        onBlur={onBlur}
        min={min ?? 0}
        className={`form-control ${error ? "is-invalid" : ""}`}
      />
      {error && <div className="invalid-feedback">{error}</div>}
    </div>
  );
}

function DurationField({ label, tip, value, onChange, error }: {
  label: string; tip: string; value: number;
  onChange: (v: number) => void; error?: string;
}) {
  return (
    <div>
      <label className="form-label small">{label} <FieldTooltip content={tip} /></label>
      <DurationInput value={value} onChange={onChange} />
      {error && <div className="text-danger small mt-1">{error}</div>}
    </div>
  );
}

interface ConfigFormProps {
  config: NovelConfigForm;
  onChange: (config: NovelConfigForm) => void;
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
    <div className="d-flex flex-column gap-4">
      {/* Chapter */}
      <Section title="Chapter">
        <div className="row g-3">
          <div className="col-md-6">
            <NumberField label="Min Chapter Length (bytes)" tip="Minimum content size in bytes. CJK characters are ~3 bytes each."
              value={config.minChapterLength} onChange={(v) => update("minChapterLength", v)} onBlur={() => blur("minChapterLength")} error={errors.minChapterLength} min={1} />
          </div>
          <div className="col-md-6">
            <NumberField label="Max Chapter Length (bytes)" tip="Maximum content size in bytes. Limits gas costs and keeps chapters readable."
              value={config.maxChapterLength} onChange={(v) => update("maxChapterLength", v)} onBlur={() => blur("maxChapterLength")} error={errors.maxChapterLength} min={1} />
          </div>
        </div>
      </Section>

      {/* Rounds */}
      <Section title="Rounds">
        <div className="row g-3">
          <div className="col-md-6">
            <DurationField label="Round Min Duration" tip="Minimum time the submission phase must last before it can close."
              value={config.roundMinDuration} onChange={(v) => update("roundMinDuration", v)} error={errors.roundMinDuration} />
          </div>
          <div className="col-md-6">
            <NumberField label="Min Submissions per Round" tip="Minimum chapter submissions required before voting. Must be >= World Line Count."
              value={config.roundMinSubmissions} onChange={(v) => update("roundMinSubmissions", v)} onBlur={() => blur("roundMinSubmissions")} error={errors.roundMinSubmissions} min={1} />
          </div>
          <div className="col-md-6">
            <NumberField label="World Line Count" tip="Parallel story branches kept each round. Top N voted chapters become world lines."
              value={config.worldLineCount} onChange={(v) => update("worldLineCount", v)} onBlur={() => blur("worldLineCount")} error={errors.worldLineCount} min={1} />
          </div>
          <div className="col-md-6">
            <NumberField label="Rounds per Epoch" tip="Rounds before Epoch voting. At epoch end, one world line is elected as Canon."
              value={config.roundsPerEpoch} onChange={(v) => update("roundsPerEpoch", v)} onBlur={() => blur("roundsPerEpoch")} error={errors.roundsPerEpoch} min={1} />
          </div>
        </div>
      </Section>

      {/* Voting */}
      <Section title="Voting">
        <div className="row g-3">
          <div className="col-md-6">
            <DurationField label="Commit Duration" tip="Time for voters to submit encrypted vote commitments."
              value={config.commitDuration} onChange={(v) => update("commitDuration", v)} error={errors.commitDuration} />
          </div>
          <div className="col-md-6">
            <DurationField label="Reveal Duration" tip="Time for voters to reveal votes. Unrevealed votes are confiscated."
              value={config.revealDuration} onChange={(v) => update("revealDuration", v)} error={errors.revealDuration} />
          </div>
        </div>
      </Section>

      {/* Economics */}
      <Section title="Economics">
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label small">Stake Amount ({TOKEN_SYMBOL}) <FieldTooltip content="Anti-spam deposit. Normal losers get full refund; only spam-flagged authors lose 50%." /></label>
            <input
              type="text"
              value={config.stakeAmount}
              onChange={(e) => update("stakeAmount", e.target.value)}
              onBlur={() => blur("stakeAmount")}
              className={`form-control ${errors.stakeAmount ? "is-invalid" : ""}`}
            />
            {errors.stakeAmount && <div className="invalid-feedback">{errors.stakeAmount}</div>}
          </div>
          <div className="col-md-6" />
          <div className="col-md-6">
            <label className="form-label small">Prize Release Rate <FieldTooltip content="Percentage of the prize pool released each Epoch." /></label>
            <PercentSlider value={config.prizeReleaseRate} onChange={(v) => update("prizeReleaseRate", v)} max={5000} step={100} />
          </div>
          <div className="col-md-6">
            <label className="form-label small">Voter Reward Rate <FieldTooltip content="Share of epoch rewards for voters." /></label>
            <PercentSlider value={config.voterRewardRate} onChange={(v) => update("voterRewardRate", v)} max={2000} step={100} />
          </div>
        </div>
      </Section>

      {/* Anti-Spam */}
      <Section title="Anti-Spam">
        <div className="row g-3">
          <div className="col-md-6">
            <NumberField label="Strikes Before Slash" tip="Consecutive rounds in the bottom tier before 50% stake slash."
              value={config.pollutionRounds} onChange={(v) => update("pollutionRounds", v)} onBlur={() => blur("pollutionRounds")} error={errors.pollutionRounds} min={1} />
          </div>
          <div className="col-md-6">
            <label className="form-label small">Bottom Tier <FieldTooltip content="Authors ranking in the lowest X% each round receive a strike." /></label>
            <RawPercentSlider value={config.pollutionThreshold} onChange={(v) => update("pollutionThreshold", v)} min={5} max={50} step={5} />
          </div>
        </div>
      </Section>

      {/* Content Storage */}
      <Section title="Content Storage">
        <div>
          <label className="form-label small">Content Location <FieldTooltip content="Where chapter text is stored. Immutable after creation." /></label>
          {contentLocationReadOnly ? (
            <p className="small text-body-secondary">{selectedLoc?.label ?? "Unknown"} — {selectedLoc?.desc}</p>
          ) : (
            <>
              <div className="btn-group mb-2">
                {CONTENT_LOCATIONS.map((loc) => (
                  <button
                    key={loc.value}
                    type="button"
                    onClick={() => { update("contentLocation", loc.value); blur("contentBaseUrl"); }}
                    className={`btn btn-sm ${config.contentLocation === loc.value ? "btn-primary" : "btn-outline-secondary"}`}
                  >
                    {loc.label}
                  </button>
                ))}
              </div>
              {selectedLoc && <p className="form-text">{selectedLoc.desc}</p>}
            </>
          )}
        </div>
        {config.contentLocation !== 0 && (
          <div className="mt-3">
            <label className="form-label small">Content Base URL</label>
            <input
              type="text"
              value={config.contentBaseUrl}
              onChange={(e) => update("contentBaseUrl", e.target.value)}
              onBlur={() => blur("contentBaseUrl")}
              placeholder="https://..."
              className={`form-control ${errors.contentBaseUrl ? "is-invalid" : ""}`}
            />
            {errors.contentBaseUrl && <div className="invalid-feedback">{errors.contentBaseUrl}</div>}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h6 className="text-body-secondary mb-2">{title}</h6>
      {children}
    </div>
  );
}
