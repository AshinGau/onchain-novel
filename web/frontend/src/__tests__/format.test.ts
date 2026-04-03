import { describe, it, expect } from "vitest";
import { shortenAddress, formatEth, timeAgo } from "@/lib/format";

describe("shortenAddress", () => {
  it("shortens a full address", () => {
    expect(shortenAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"))
      .toBe("0x7099...79C8");
  });

  it("returns empty for empty input", () => {
    expect(shortenAddress("")).toBe("");
  });
});

describe("formatEth", () => {
  it("formats wei to ETH with decimals", () => {
    expect(formatEth("1000000000000000000")).toBe("1.00"); // 1 ETH
  });

  it("formats small amounts", () => {
    expect(formatEth("10000000000000000")).toBe("0.01"); // 0.01 ETH
  });

  it("returns 0 for zero", () => {
    expect(formatEth("0")).toBe("0");
  });

  it("shows exact value for small amounts", () => {
    expect(formatEth("100000000000")).toBe("0.0000001");
    expect(formatEth("10000000000000")).toBe("0.00001");
  });
});

describe("timeAgo", () => {
  it("returns 'just now' for recent times", () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(twoHoursAgo)).toBe("2h ago");
  });

  it("returns days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(threeDaysAgo)).toBe("3d ago");
  });
});
