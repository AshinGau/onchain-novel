"use client";

interface PercentSliderProps {
  /** Value in basis points (0-10000) */
  value: number;
  onChange: (bps: number) => void;
  min?: number;  // bps
  max?: number;  // bps
  step?: number; // bps
}

export function PercentSlider({ value, onChange, min = 0, max = 5000, step = 100 }: PercentSliderProps) {
  const percent = Math.round(value / 100);

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 accent-white cursor-pointer"
      />
      <span className="text-sm text-neutral-100 w-10 text-right tabular-nums">{percent}%</span>
    </div>
  );
}

/** Percent slider for direct percentage values (0-100), stored as integer */
export function RawPercentSlider({ value, onChange, min = 0, max = 50, step = 5 }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 accent-white cursor-pointer"
      />
      <span className="text-sm text-neutral-100 w-10 text-right tabular-nums">{value}%</span>
    </div>
  );
}
