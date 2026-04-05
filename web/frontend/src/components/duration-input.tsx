"use client";

import { useState, useEffect } from "react";

type Unit = "s" | "min" | "h" | "d";

const UNIT_SECONDS: Record<Unit, number> = { s: 1, min: 60, h: 3600, d: 86400 };
const UNIT_LABELS: Record<Unit, string> = { s: "sec", min: "min", h: "hours", d: "days" };

function bestUnit(seconds: number): Unit {
  if (seconds % 86400 === 0 && seconds >= 86400) return "d";
  if (seconds % 3600 === 0 && seconds >= 3600) return "h";
  if (seconds % 60 === 0 && seconds >= 60) return "min";
  return "s";
}

interface DurationInputProps {
  value: number;
  onChange: (seconds: number) => void;
}

export function DurationInput({ value, onChange }: DurationInputProps) {
  const [unit, setUnit] = useState<Unit>(() => bestUnit(value));
  const [display, setDisplay] = useState(() => String(value / UNIT_SECONDS[bestUnit(value)]));

  useEffect(() => {
    const u = bestUnit(value);
    setUnit(u);
    setDisplay(String(value / UNIT_SECONDS[u]));
  }, [value]);

  function handleValueChange(v: string) {
    setDisplay(v);
    const num = parseFloat(v);
    if (!isNaN(num) && num >= 0) {
      onChange(Math.round(num * UNIT_SECONDS[unit]));
    }
  }

  function handleUnitChange(u: Unit) {
    setUnit(u);
    const num = parseFloat(display);
    if (!isNaN(num) && num >= 0) {
      onChange(Math.round(num * UNIT_SECONDS[u]));
    }
  }

  return (
    <div className="input-group">
      <input
        type="number"
        min="0"
        step="any"
        value={display}
        onChange={(e) => handleValueChange(e.target.value)}
        className="form-control"
      />
      <select
        value={unit}
        onChange={(e) => handleUnitChange(e.target.value as Unit)}
        className="form-select"
        style={{ maxWidth: 90 }}
      >
        {(Object.keys(UNIT_SECONDS) as Unit[]).map((u) => (
          <option key={u} value={u}>{UNIT_LABELS[u]}</option>
        ))}
      </select>
    </div>
  );
}
