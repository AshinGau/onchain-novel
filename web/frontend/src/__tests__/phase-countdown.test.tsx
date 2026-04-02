import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PhaseCountdown } from "@/components/phase-countdown";

describe("PhaseCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseConfig = {
    roundMinDuration: "3600", // 1 hour
    commitDuration: "7200",   // 2 hours
    revealDuration: "5400",   // 1.5 hours
  };

  it("shows remaining time during Submitting phase", () => {
    const now = Math.floor(Date.now() / 1000);
    // Phase started 30 minutes ago, duration is 1 hour → 30 min remaining
    const startTime = String(now - 1800);

    vi.setSystemTime(now * 1000);

    render(
      <PhaseCountdown
        phaseStartTime={startTime}
        roundPhase={0}
        epochPhase={0}
        config={baseConfig}
      />
    );

    expect(screen.getByText(/remaining/)).toBeInTheDocument();
    expect(screen.getByText(/30m/)).toBeInTheDocument();
  });

  it("shows expired when phase time has passed", () => {
    const now = Math.floor(Date.now() / 1000);
    // Phase started 2 hours ago, duration is 1 hour → expired
    const startTime = String(now - 7200);

    vi.setSystemTime(now * 1000);

    render(
      <PhaseCountdown
        phaseStartTime={startTime}
        roundPhase={0}
        epochPhase={0}
        config={baseConfig}
      />
    );

    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });

  it("uses commitDuration during Committing phase", () => {
    const now = Math.floor(Date.now() / 1000);
    // Phase started 1 hour ago, commitDuration is 2 hours → 1 hour remaining
    const startTime = String(now - 3600);

    vi.setSystemTime(now * 1000);

    render(
      <PhaseCountdown
        phaseStartTime={startTime}
        roundPhase={1}
        epochPhase={0}
        config={baseConfig}
      />
    );

    expect(screen.getByText(/1h 0m 0s remaining/)).toBeInTheDocument();
  });

  it("uses revealDuration during Revealing phase", () => {
    const now = Math.floor(Date.now() / 1000);
    // Phase started 30 min ago, revealDuration is 1.5 hours → 1 hour remaining
    const startTime = String(now - 1800);

    vi.setSystemTime(now * 1000);

    render(
      <PhaseCountdown
        phaseStartTime={startTime}
        roundPhase={2}
        epochPhase={0}
        config={baseConfig}
      />
    );

    expect(screen.getByText(/1h 0m 0s remaining/)).toBeInTheDocument();
  });

  it("uses commitDuration during Epoch Committing phase", () => {
    const now = Math.floor(Date.now() / 1000);
    const startTime = String(now - 3600);

    vi.setSystemTime(now * 1000);

    render(
      <PhaseCountdown
        phaseStartTime={startTime}
        roundPhase={0}
        epochPhase={1}
        config={baseConfig}
      />
    );

    expect(screen.getByText(/1h 0m 0s remaining/)).toBeInTheDocument();
  });

  it("renders nothing during Settling phase", () => {
    const now = Math.floor(Date.now() / 1000);
    const startTime = String(now - 100);

    vi.setSystemTime(now * 1000);

    const { container } = render(
      <PhaseCountdown
        phaseStartTime={startTime}
        roundPhase={3}
        epochPhase={0}
        config={baseConfig}
      />
    );

    expect(container.innerHTML).toBe("");
  });

  it("updates countdown every second", () => {
    const now = Math.floor(Date.now() / 1000);
    const startTime = String(now - 3595); // 5 seconds remaining (roundMinDuration=3600)

    vi.setSystemTime(now * 1000);

    render(
      <PhaseCountdown
        phaseStartTime={startTime}
        roundPhase={0}
        epochPhase={0}
        config={baseConfig}
      />
    );

    expect(screen.getByText(/5s remaining/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText(/3s remaining/)).toBeInTheDocument();
  });
});
