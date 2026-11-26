import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "./types.js";

export const DEFAULT_CONFIG: Config = {
  queries: ['label:"💎 Bounty" state:open is:issue'],
  maxIssuesPerQuery: 100,
  updatedWithinDays: 90,
  stack: { languages: ["TypeScript", "JavaScript"], keywords: ["react", "node"] },
  minAmountUsd: 50,
  requireAmount: false,
  minStars: 50,
  maxAttempts: 3,
  maxPerRepo: 2,
  excludeLabels: ["💰 Rewarded", "rewarded", "on-hold"],
  redFlagKeywords: ["autonomous agents only", "airdrop"],
  weights: { amount: 25, stack: 25, competition: 20, trust: 15, freshness: 8, clarity: 7 },
  report: { top: 25, outDir: "out" },
  draft: { workDir: ".bounty-scout/work", outDir: "out/drafts", allowShell: false, extraClaudeArgs: [] },
};

export function loadConfig(path = "bounty-scout.config.json"): Config {
  const full = resolve(path);
  if (!existsSync(full)) return DEFAULT_CONFIG;
  const user = JSON.parse(readFileSync(full, "utf8")) as Partial<Config>;
  return {
    ...DEFAULT_CONFIG,
    ...user,
    stack: { ...DEFAULT_CONFIG.stack, ...user.stack },
    weights: { ...DEFAULT_CONFIG.weights, ...user.weights },
    report: { ...DEFAULT_CONFIG.report, ...user.report },
    draft: { ...DEFAULT_CONFIG.draft, ...user.draft },
  };
}
