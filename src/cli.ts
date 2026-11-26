#!/usr/bin/env node
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { GitHubClient } from "./github.js";
import { scan } from "./scan.js";
import { rank } from "./score.js";
import { markNew, writeReports } from "./report.js";
import { draft } from "./draft.js";
import { existsSync } from "node:fs";

// Load GITHUB_TOKEN and friends from a local .env file (gitignored), if present.
if (existsSync(".env")) process.loadEnvFile(".env");

const HELP = `bounty-scout — find open-source bounties worth your time

Usage:
  bounty-scout scan [--config path] [--top N] [--out dir] [--seen file] [--fast]
      Search GitHub for bounties, rank them and write out/index.html, report.md, bounties.json
      --fast skips repo/comment lookups (3 API calls, less accurate ranking)

  bounty-scout draft <issue-url> [--config path] [--shell]
      Clone the repo and let Claude Code prepare a draft fix + notes for you to review.
      Nothing is pushed or posted. --shell lets the agent run commands (use a container).

Environment:
  GITHUB_TOKEN   recommended: raises GitHub API limits (no scopes needed for public repos)
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(HELP);
    return;
  }

  const cfg = loadConfig(flag(args, "--config"));
  const gh = new GitHubClient();
  if (!gh.authenticated) console.error("! no GITHUB_TOKEN set: running with low anonymous rate limits");

  if (cmd === "scan") {
    const top = Number(flag(args, "--top") ?? cfg.report.top);
    const outDir = flag(args, "--out") ?? cfg.report.outDir;
    const seenPath = flag(args, "--seen") ?? join("data", "seen.json");

    const bounties = await scan(cfg, gh, { enrich: !args.includes("--fast") });
    const ranked = rank(bounties, cfg);
    const fresh = markNew(ranked.filter((b) => !b.excluded), seenPath);
    const files = writeReports(
      ranked,
      { generatedAt: new Date().toISOString(), scanned: bounties.length, queries: cfg.queries },
      outDir,
      top,
      fresh,
    );

    const shortlist = ranked.filter((b) => !b.excluded).slice(0, Math.min(top, 10));
    console.log(`\nTop ${shortlist.length} of ${bounties.length} scanned:\n`);
    for (const b of shortlist) {
      const amt = b.amountUsd === null ? "   ?" : `$${b.amountUsd}`.padStart(6);
      const flags = b.redFlags.length ? "  ⚠ " + b.redFlags.join("; ") : "";
      console.log(`${String(b.score).padStart(3)}  ${amt}  ${b.repo}#${b.number}  ${b.title.slice(0, 60)}${flags}`);
    }
    console.log(`\nReport: ${files.html}\n        ${files.md}`);
    return;
  }

  if (cmd === "draft") {
    const url = args.find((a) => a.startsWith("http"));
    if (!url) throw new Error("draft needs an issue URL");
    if (args.includes("--shell")) cfg.draft.allowShell = true;
    const res = await draft(url, cfg, gh);
    console.log(`\nDraft ready (${res.changedFiles} file(s) changed)`);
    console.log(`  patch: ${res.patchPath}`);
    if (res.notesPath) console.log(`  notes: ${res.notesPath}`);
    console.log(`\nReview it, then apply in your own fork with: git apply ${res.patchPath}`);
    return;
  }

  throw new Error(`unknown command "${cmd}"\n\n${HELP}`);
}

main().catch((e) => {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
});
