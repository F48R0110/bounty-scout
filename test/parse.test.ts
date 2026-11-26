import { describe, expect, it } from "vitest";
import { bountyAmountsInText, countAttempts, countClaims, moneyValues, parseAmount } from "../src/parse.js";
import type { GhComment } from "../src/types.js";

const c = (body: string, login = "dev"): GhComment => ({ body, user: { login }, created_at: "2026-11-01T00:00:00Z" });

describe("moneyValues", () => {
  it("reads plain, comma and k amounts", () => {
    expect(moneyValues("$150")).toEqual([150]);
    expect(moneyValues("$1,500")).toEqual([1500]);
    expect(moneyValues("$8k and $10K")).toEqual([8000, 10000]);
    expect(moneyValues("$ 75")).toEqual([75]);
  });
  it("ignores things that are not amounts", () => {
    expect(moneyValues("use $variable here")).toEqual([]);
    expect(moneyValues("costs $5kb")).toEqual([]);
  });
});

describe("bountyAmountsInText", () => {
  it("only keeps amounts near the word bounty", () => {
    const text = "Our server costs $400/month." + " Lorem ipsum dolor sit amet.".repeat(5) + " This bounty pays $250.";
    expect(bountyAmountsInText(text)).toEqual([250]);
  });
});

describe("parseAmount", () => {
  it("prefers amount labels", () => {
    expect(parseAmount(["💎 Bounty", "$150"], "bounty $999", [])).toBe(150);
  });
  it("falls back to bot comments, then the body", () => {
    expect(parseAmount(["💎 Bounty"], "", [c("## 💎 $300 bounty • acme")])).toBe(300);
    expect(parseAmount([], "[Bounty: $75] Fix rounding", [])).toBe(75);
  });
  it("returns null when no amount is stated", () => {
    expect(parseAmount(["💎 Bounty"], "please fix", [c("+1")])).toBeNull();
  });
});

describe("attempts and claims", () => {
  it("counts distinct people attempting", () => {
    const comments = [c("/attempt #12", "a"), c("/attempt #12", "a"), c("/attempt #12", "b"), c("nice", "c")];
    expect(countAttempts(comments)).toBe(2);
  });
  it("counts PR claims", () => {
    expect(countClaims([c("💡 @a submitted a pull request that claims the bounty"), c("/claim #45"), c("hi")])).toBe(2);
  });
});
