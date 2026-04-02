import { describe, it, expect } from "vitest";

// Test the byte counting logic used in write page and create page
// The frontend uses TextEncoder to count bytes (same as contract's declaredLength)

function getByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe("byte counter (TextEncoder)", () => {
  it("counts ASCII characters as 1 byte each", () => {
    expect(getByteLength("hello")).toBe(5);
    expect(getByteLength("")).toBe(0);
    expect(getByteLength("a")).toBe(1);
  });

  it("counts Chinese characters as 3 bytes each (UTF-8)", () => {
    expect(getByteLength("你好")).toBe(6); // 2 chars × 3 bytes
    expect(getByteLength("一二三")).toBe(9); // 3 chars × 3 bytes
  });

  it("counts emoji as 4 bytes each (UTF-8)", () => {
    expect(getByteLength("🔥")).toBe(4);
    expect(getByteLength("👍🏻")).toBe(8); // skin tone modifier
  });

  it("counts mixed content correctly", () => {
    const text = "Hello 你好 🔥";
    // "Hello " = 6 bytes, "你好" = 6 bytes, " " = 1 byte, "🔥" = 4 bytes
    expect(getByteLength(text)).toBe(17);
  });

  it("validates against chapter length range", () => {
    const min = 100;
    const max = 10000;
    const shortText = "x".repeat(50);
    const validText = "x".repeat(500);
    const longText = "x".repeat(20000);

    const shortLen = getByteLength(shortText);
    const validLen = getByteLength(validText);
    const longLen = getByteLength(longText);

    expect(shortLen < min).toBe(true);
    expect(validLen >= min && validLen <= max).toBe(true);
    expect(longLen > max).toBe(true);
  });
});
