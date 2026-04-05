"use client";

import { useState, useEffect } from "react";

interface PhaseCountdownProps {
  phaseStartTime: string;
  roundPhase: number;
  epochPhase: number;
  config: {
    roundMinDuration: string;
    commitDuration: string;
    revealDuration: string;
  };
}

function getDeadline(props: PhaseCountdownProps): number | null {
  const start = Number(props.phaseStartTime) * 1000; // unix seconds -> ms
  if (!start || isNaN(start)) return null;

  const { roundPhase, epochPhase, config } = props;

  if (epochPhase === 0 && roundPhase === 0) {
    return start + Number(config.roundMinDuration) * 1000;
  }
  if (epochPhase === 0 && roundPhase === 1) {
    return start + Number(config.commitDuration) * 1000;
  }
  if (epochPhase === 0 && roundPhase === 2) {
    return start + Number(config.revealDuration) * 1000;
  }
  if (epochPhase === 1) {
    return start + Number(config.commitDuration) * 1000;
  }
  if (epochPhase === 2) {
    return start + Number(config.revealDuration) * 1000;
  }

  return null;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h ${m}m ${s}s remaining`;
  if (m > 0) return `${m}m ${s}s remaining`;
  return `${s}s remaining`;
}

export function PhaseCountdown(props: PhaseCountdownProps) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const deadline = getDeadline(props);
    if (deadline === null) {
      setRemaining(null);
      return;
    }

    function tick() {
      setRemaining(deadline! - Date.now());
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [props.phaseStartTime, props.roundPhase, props.epochPhase, props.config.roundMinDuration, props.config.commitDuration, props.config.revealDuration]);

  if (remaining === null) return null;

  const expired = remaining <= 0;

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
        expired
          ? "bg-yellow-900/50 text-yellow-400 border border-yellow-800"
          : "bg-blue-900/50 text-blue-300 border border-blue-800"
      }`}
    >
      {expired ? "Phase expired \u2014 awaiting transition" : formatRemaining(remaining)}
    </span>
  );
}
