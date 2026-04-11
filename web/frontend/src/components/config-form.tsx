"use client";

import { useState, useCallback } from "react";
import { TOKEN_SYMBOL } from "@/lib/config";
import { type NovelConfigForm, CONTENT_LOCATIONS, validateField } from "@/lib/novel-config";

function formatDuration(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400} days`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} hours`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} sec`;
}

function NumberField({ label, tip, value, onChange, onBlur, error, min }: {
  label: string; tip: string; value: number;
  onChange: (v: number) => void; onBlur: () => void;
  error?: string; min?: number;
}) {
  return (
    <div>
      <label className="on-form-label">{label}</label>
      <p className="on-form-tip">{tip}</p>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min ?? 0, Number(e.target.value)))}
        onBlur={onBlur}
        min={min ?? 0}
        className={`on-form-input ${error ? "border-danger" : ""}`}
      />
      {error ? <p className="on-form-error">{error}</p> : null}
    </div>
  );
}

function DurationField({ label, tip, value, onChange, error }: {
  label: string; tip: string; value: number;
  onChange: (v: number) => void; error?: string;
}) {
  type Unit = "s" | "min" | "h" | "d";
  const unitSec: Record<Unit, number> = { s: 1, min: 60, h: 3600, d: 86400 };

  function bestUnit(s: number): Unit {
    if (s % 86400 === 0 && s >= 86400) return "d";
    if (s % 3600 === 0 && s >= 3600) return "h";
    if (s % 60 === 0 && s >= 60) return "min";
    return "s";
  }

  const [unit, setUnit] = useState<Unit>(() => bestUnit(value));
  const display = String(value / unitSec[unit]);

  return (
    <div>
      <label className="on-form-label">{label}</label>
      <p className="on-form-tip">{tip}</p>
      <div className="on-row" style={{ gap: "0.5rem" }}>
        <input
          type="number"
          min="0"
          step="any"
          value={display}
          onChange={(e) => {
            const num = parseFloat(e.target.value);
            if (!isNaN(num) && num >= 0) onChange(Math.round(num * unitSec[unit]));
          }}
          className="on-form-input"
          style={{ flex: 1 }}
        />
        <select
          value={unit}
          onChange={(e) => {
            const u = e.target.value as Unit;
            setUnit(u);
            const num = parseFloat(display);
            if (!isNaN(num)) onChange(Math.round(num * unitSec[u]));
          }}
          className="on-form-input"
          style={{ width: "5rem" }}
        >
          <option value="s">sec</option>
          <option value="min">min</option>
          <option value="h">hours</option>
          <option value="d">days</option>
        </select>
      </div>
      {error ? <p className="on-form-error">{error}</p> : null}
    </div>
  );
}

function PercentSlider({ label, tip, value, onChange, max = 5000, step = 100 }: {
  label: string; tip: string; value: number; onChange: (v: number) => void; max?: number; step?: number;
}) {
  return (
    <div>
      <label className="on-form-label">{label}</label>
      <p className="on-form-tip">{tip}</p>
      <div className="on-row" style={{ gap: "0.75rem" }}>
        <input
          type="range"
          min={0}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span className="text-caption" style={{ width: "3rem", textAlign: "right" }}>
          {Math.round(value / 100)}%
        </span>
      </div>
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
    <div className="on-stack">
      {/* Chapter */}
      <Section title="Chapter">
        <div className="on-grid on-grid-2">
          <NumberField label="Min Chapter Length (bytes)" tip="Minimum content size in bytes."
            value={config.minChapterLength} onChange={(v) => update("minChapterLength", v)} onBlur={() => blur("minChapterLength")} error={errors.minChapterLength} min={1} />
          <NumberField label="Max Chapter Length (bytes)" tip="Maximum content size in bytes."
            value={config.maxChapterLength} onChange={(v) => update("maxChapterLength", v)} onBlur={() => blur("maxChapterLength")} error={errors.maxChapterLength} min={1} />
        </div>
      </Section>

      {/* Rounds */}
      <Section title="Rounds">
        <div className="on-grid on-grid-2">
          <NumberField label="World Line Count" tip="Parallel story branches kept each round."
            value={config.worldLineCount} onChange={(v) => update("worldLineCount", v)} onBlur={() => blur("worldLineCount")} error={errors.worldLineCount} min={1} />
          <DurationField label="Min Round Gap" tip="Minimum interval between rounds."
            value={config.minRoundGap} onChange={(v) => update("minRoundGap", v)} error={errors.minRoundGap} />
          <DurationField label="Nominate Duration" tip="Time for candidate nominations."
            value={config.nominateDuration} onChange={(v) => update("nominateDuration", v)} error={errors.nominateDuration} />
        </div>
      </Section>

      {/* Voting */}
      <Section title="Voting">
        <div className="on-grid on-grid-2">
          <DurationField label="Commit Duration" tip="Time for voters to submit encrypted commitments."
            value={config.commitDuration} onChange={(v) => update("commitDuration", v)} error={errors.commitDuration} />
          <DurationField label="Reveal Duration" tip="Time for voters to reveal votes."
            value={config.revealDuration} onChange={(v) => update("revealDuration", v)} error={errors.revealDuration} />
        </div>
      </Section>

      {/* Economics */}
      <Section title="Economics">
        <div className="on-grid on-grid-2">
          <div>
            <label className="on-form-label">Submission Fee ({TOKEN_SYMBOL})</label>
            <p className="on-form-tip">Fee per chapter submission (min 0.0001).</p>
            <input type="text" value={config.submissionFee}
              onChange={(e) => update("submissionFee", e.target.value)}
              onBlur={() => blur("submissionFee")}
              className={`on-form-input ${errors.submissionFee ? "border-danger" : ""}`} />
            {errors.submissionFee && <p className="on-form-error">{errors.submissionFee}</p>}
          </div>
          <div>
            <label className="on-form-label">Vote Stake ({TOKEN_SYMBOL})</label>
            <p className="on-form-tip">Required stake per vote commitment.</p>
            <input type="text" value={config.voteStake}
              onChange={(e) => update("voteStake", e.target.value)}
              onBlur={() => blur("voteStake")}
              className={`on-form-input ${errors.voteStake ? "border-danger" : ""}`} />
            {errors.voteStake && <p className="on-form-error">{errors.voteStake}</p>}
          </div>
          <div>
            <label className="on-form-label">Nomination Fee ({TOKEN_SYMBOL})</label>
            <p className="on-form-tip">Fee to nominate an additional candidate.</p>
            <input type="text" value={config.nominationFee}
              onChange={(e) => update("nominationFee", e.target.value)}
              onBlur={() => blur("nominationFee")}
              className={`on-form-input ${errors.nominationFee ? "border-danger" : ""}`} />
          </div>
          <div>{/* spacer */}</div>
          <PercentSlider label="Prize Release Rate" tip="Percentage of prize pool released each round."
            value={config.prizeReleaseRate} onChange={(v) => update("prizeReleaseRate", v)} />
          <PercentSlider label="Voter Reward Rate" tip="Share of round rewards allocated to voters."
            value={config.voterRewardRate} onChange={(v) => update("voterRewardRate", v)} max={5000} />
        </div>
      </Section>

      {/* Rules */}
      <Section title="Rules (AI Agents)">
        <div className="on-grid on-grid-2">
          <div>
            <label className="on-form-label">Rule Proposal Fee ({TOKEN_SYMBOL})</label>
            <p className="on-form-tip">Fee required to propose a new world-building rule.</p>
            <input type="text" value={config.ruleFee}
              onChange={(e) => update("ruleFee", e.target.value)}
              onBlur={() => blur("ruleFee")}
              className={`on-form-input ${errors.ruleFee ? "border-danger" : ""}`} />
          </div>
          <NumberField label="Rule Vote Quorum" tip="World-line-author votes needed to pass."
            value={config.ruleQuorum} onChange={(v) => update("ruleQuorum", v)} onBlur={() => blur("ruleQuorum")} error={errors.ruleQuorum} min={0} />
          <DurationField label="Rule Vote Duration" tip="Time window for rule proposal voting."
            value={config.ruleVoteDuration} onChange={(v) => update("ruleVoteDuration", v)} error={errors.ruleVoteDuration} />
        </div>
      </Section>

      {/* Content Storage */}
      <Section title="Content Storage">
        <div>
          <label className="on-form-label">Content Location</label>
          {contentLocationReadOnly ? (
            <p className="text-caption" style={{ marginTop: "0.25rem" }}>{selectedLoc?.label} — {selectedLoc?.desc}</p>
          ) : (
            <>
              <div className="on-row" style={{ gap: "0.5rem", marginTop: "0.25rem" }}>
                {CONTENT_LOCATIONS.map((loc) => (
                  <button
                    key={loc.value}
                    type="button"
                    onClick={() => { update("contentLocation", loc.value); blur("contentBaseUrl"); }}
                    className={`on-btn ${config.contentLocation === loc.value ? "on-btn-primary" : "on-btn-secondary"}`}
                  >
                    {loc.label}
                  </button>
                ))}
              </div>
              {selectedLoc && <p className="on-form-desc">{selectedLoc.desc}</p>}
            </>
          )}
        </div>
        {config.contentLocation !== 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <label className="on-form-label">Content Base URL</label>
            <input type="text" value={config.contentBaseUrl}
              onChange={(e) => update("contentBaseUrl", e.target.value)}
              onBlur={() => blur("contentBaseUrl")}
              placeholder="https://..."
              className={`on-form-input ${errors.contentBaseUrl ? "border-danger" : ""}`} />
            {errors.contentBaseUrl && <p className="on-form-error">{errors.contentBaseUrl}</p>}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="on-form-section-title">{title}</h3>
      {children}
    </div>
  );
}
