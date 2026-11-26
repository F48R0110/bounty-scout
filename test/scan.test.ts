import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { scan } from "../src/scan.js";
import type { GitHubClient } from "../src/github.js";
import type { GhIssue } from "../src/types.js";

const issue = (n: number, repo: string, labels: string[]): GhIssue => ({
  html_url: `https://github.com/${repo}/issues/${n}`,
  repository_url: `https://api.github.com/repos/${repo}`,
  number: n,
  title: `Issue ${n}`,
  body: "Please fix",
  labels: labels.map((name) => ({ name })),
  comments: 2,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-20T00:00:00Z",
});

describe("scan", () => {
  it("dedupes across queries and enriches from repo + comments", async () => {
    const fake = {
      searchIssues: async () => [issue(1, "acme/app", ["💎 Bounty"]), issue(2, "acme/app", ["💰 Rewarded"])],
      repo: async () => ({ full_name: "acme/app", language: "TypeScript", stargazers_count: 1200 }),
      comments: async () => [
        { user: { login: "algora-pbc" }, body: "## 💎 $400 bounty • Acme", created_at: "" },
        { user: { login: "dev1" }, body: "/attempt #1", created_at: "" },
      ],
    } as unknown as GitHubClient;

    const cfg = { ...DEFAULT_CONFIG, queries: ["q1", "q2"] };
    const out = await scan(cfg, fake, { log: () => {} });
    expect(out).toHaveLength(2);
    const one = out.find((b) => b.number === 1)!;
    expect(one.amountUsd).toBe(400);
    expect(one.attempts).toBe(1);
    expect(one.repoInfo?.stargazers_count).toBe(1200);
    expect(one.repoBountyCount).toBe(2);
    // rewarded issues skip the comment lookup
    expect(out.find((b) => b.number === 2)!.attempts).toBe(0);
  });
});
