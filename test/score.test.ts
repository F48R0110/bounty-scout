import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { exclusionReason, rank, redFlags, scoreBounty } from "../src/score.js";
import type { Bounty, Config, GhRepo } from "../src/types.js";

const cfg: Config = {
  ...DEFAULT_CONFIG,
  stack: { languages: ["TypeScript"], keywords: ["react"] },
  minStars: 50,
};

const repo = (stars: number, extra: Partial<GhRepo> = {}): GhRepo => ({
  full_name: "acme/app",
  html_url: "https://github.com/acme/app",
  language: "TypeScript",
  stargazers_count: stars,
  forks_count: 10,
  archived: false,
  fork: false,
  created_at: "2020-01-01T00:00:00Z",
  pushed_at: new Date().toISOString(),
  ...extra,
});

const bounty = (over: Partial<Bounty> = {}): Bounty => ({
  url: "https://github.com/acme/app/issues/1",
  repo: "acme/app",
  number: 1,
  title: "Fix React hydration warning",
  body: "Steps to reproduce: open the page. Expected: no warning. ".repeat(6),
  labels: ["💎 Bounty", "$300"],
  createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
  updatedAt: new Date().toISOString(),
  commentCount: 3,
  assigned: false,
  amountUsd: 300,
  attempts: 0,
  openClaims: 0,
  repoInfo: repo(5000),
  repoBountyCount: 1,
  scamSignals: [],
  eligibility: [],
  ...over,
});

describe("exclusionReason", () => {
  it("keeps a healthy bounty", () => expect(exclusionReason(bounty(), cfg)).toBeNull());
  it("drops bounties you cannot be paid for", () => {
    const b = bounty({ eligibility: ["payout limited to US citizens"] });
    expect(exclusionReason(b, { ...cfg, ineligibleFor: ["US citizens"] })).toMatch(/US citizens/);
    expect(exclusionReason(b, cfg)).toBeNull();
  });
  it("drops rewarded, assigned, crowded, tiny and archived", () => {
    expect(exclusionReason(bounty({ labels: ["💰 Rewarded"] }), cfg)).toMatch(/Rewarded/);
    expect(exclusionReason(bounty({ assigned: true }), cfg)).toMatch(/assigned/);
    expect(exclusionReason(bounty({ attempts: 9 }), cfg)).toMatch(/attempting/);
    expect(exclusionReason(bounty({ amountUsd: 10 }), cfg)).toMatch(/below/);
    expect(exclusionReason(bounty({ repoInfo: repo(3) }), cfg)).toMatch(/★/);
    expect(exclusionReason(bounty({ repoInfo: repo(900, { archived: true }) }), cfg)).toMatch(/archived/);
  });
});

describe("redFlags", () => {
  it("flags bounty farms and outsized rewards", () => {
    expect(redFlags(bounty({ repoBountyCount: 12, repoInfo: repo(40) }), cfg).join()).toMatch(/farm/);
    expect(redFlags(bounty({ amountUsd: 8000, repoInfo: repo(20) }), cfg).join()).toMatch(/\$8000/);
    expect(redFlags(bounty({ repo: "someone/bug-bounty", repoInfo: null }), cfg).join()).toMatch(/only to host/);
  });
  it("surfaces scam comments", () => {
    expect(redFlags(bounty({ scamSignals: ["asks contributors to pay to claim"] }), cfg).join()).toMatch(/scam/);
  });
  it("leaves established projects alone", () => {
    expect(redFlags(bounty(), cfg)).toEqual([]);
  });
});

describe("scoreBounty", () => {
  it("rewards stack fit and low competition", () => {
    const good = scoreBounty(bounty(), cfg);
    const crowded = scoreBounty(bounty({ attempts: 3, openClaims: 1 }), cfg);
    const offStack = scoreBounty(bounty({ title: "Fix Rust panic", body: "x".repeat(400), repoInfo: repo(5000, { language: "Rust" }) }), cfg);
    expect(good.score).toBeGreaterThan(crowded.score);
    expect(good.score).toBeGreaterThan(offStack.score);
    expect(good.score).toBeLessThanOrEqual(100);
  });
  it("sinks flagged bounties", () => {
    const clean = scoreBounty(bounty(), cfg);
    const flagged = scoreBounty(bounty({ body: bounty().body + " autonomous agents only" }), {
      ...cfg,
      redFlagKeywords: ["autonomous agents only"],
    });
    expect(flagged.redFlags.length).toBe(1);
    expect(flagged.score).toBeLessThan(clean.score);
  });
});

describe("rank", () => {
  it("caps bounties per repo and puts excluded last", () => {
    const many = [1, 2, 3, 4].map((n) => bounty({ number: n, url: `u${n}` }));
    const ranked = rank([...many, bounty({ url: "x", repo: "x/y", assigned: true })], { ...cfg, maxPerRepo: 2 });
    expect(ranked.filter((b) => !b.excluded)).toHaveLength(2);
    expect(ranked.at(-1)!.excluded).not.toBeNull();
  });
});
