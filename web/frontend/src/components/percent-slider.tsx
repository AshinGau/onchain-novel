"use client";

interface PercentSliderProps {
  value: number;
  onChange: (bps: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function PercentSlider({ value, onChange, min = 0, max = 5000, step = 100 }: PercentSliderProps) {
  const percent = Math.round(value / 100);

  return (
    <div className="d-flex align-items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="form-range flex-grow-1"
      />
      <span className="small fw-medium text-nowrap" style={{ width: 40, textAlign: "right" }}>{percent}%</span>
    </div>
  );
}

export function RawPercentSlider({ value, onChange, min = 0, max = 50, step = 5 }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="d-flex align-items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="form-range flex-grow-1"
      />
      <span className="small fw-medium text-nowrap" style={{ width: 40, textAlign: "right" }}>{value}%</span>
    </div>
  );
}
