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

describe("amounts from untrusted comments", () => {
  it("trusts the bounty bot over a stranger's comment", () => {
    const comments = [
      c("💎 **dev** is offering a **$5** bounty for this issue. Claim with /claim #290", "algora-pbc"),
      c("To receive the reward, increase the bounty by $5,000 to prove you aren't a bot.", "stranger"),
    ];
    expect(parseAmount(["💎 Bounty"], "Donation for german language", comments)).toBe(5);
  });
});

describe("scamSignals", () => {
  it("flags comments asking contributors for money", async () => {
    const { scamSignals } = await import("../src/parse.js");
    const comments = [c("Open an account and increase the bounty by $5,000. This is the final test to prove you aren't a bot.", "x")];
    expect(scamSignals(comments).length).toBeGreaterThan(0);
    expect(scamSignals([c("/attempt #1"), c("💎 $5 bounty — pay attention to the tests", "algora-pbc")])).toEqual([]);
  });
});

describe("plain-language attempts and eligibility", () => {
  it("counts people who claim the issue in words", () => {
    expect(countAttempts([c("I'd like to pick this up. I'll post a PR soon", "rose"), c("thanks!", "maintainer")])).toBe(1);
  });
  it("finds payout restrictions in the issue or thread", async () => {
    const { eligibilitySignals } = await import("../src/parse.js");
    expect(eligibilitySignals("## Bounty: $150", [c("I confirm I am 18 or older, a US citizen, and not an HHS employee")])).toEqual([
      "payout limited to US citizens",
    ]);
    expect(eligibilitySignals("Fix the bug", [])).toEqual([]);
  });
});

describe("linkedRuleDocs", () => {
  it("finds terms documents linked from the issue", async () => {
    const { linkedRuleDocs } = await import("../src/parse.js");
    const body = "Read the [terms](https://github.com/HHS/simpler-grants-gov/blob/main/documentation/bounties/paid-contributor-TOS.md) and the [design](https://github.com/x/y/blob/main/docs/design.md).";
    expect(linkedRuleDocs(body)).toEqual([{ repo: "HHS/simpler-grants-gov", path: "documentation/bounties/paid-contributor-TOS.md" }]);
  });
});
