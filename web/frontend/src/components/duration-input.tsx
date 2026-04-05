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
  value: number; // seconds
  onChange: (seconds: number) => void;
  className?: string;
}

export function DurationInput({ value, onChange, className }: DurationInputProps) {
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

  const inputClass = className || "w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-neutral-500";

  return (
    <div className="flex gap-1.5">
      <input
        type="number"
        min="0"
        step="any"
        value={display}
        onChange={(e) => handleValueChange(e.target.value)}
        className={inputClass + " flex-1"}
      />
      <select
        value={unit}
        onChange={(e) => handleUnitChange(e.target.value as Unit)}
        className="rounded-lg bg-neutral-900 border border-neutral-700 px-2 py-2 text-sm text-neutral-100 focus:outline-none focus:border-neutral-500"
      >
        {(Object.keys(UNIT_SECONDS) as Unit[]).map((u) => (
          <option key={u} value={u}>{UNIT_LABELS[u]}</option>
        ))}
      </select>
    </div>
  );
}
