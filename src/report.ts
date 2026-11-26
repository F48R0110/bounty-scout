import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ScoredBounty } from "./types.js";

export interface ReportMeta {
  generatedAt: string;
  scanned: number;
  queries: string[];
}

type Seen = Record<string, string>; // url -> first seen ISO date

export function markNew(bounties: ScoredBounty[], seenPath: string): Set<string> {
  const seen: Seen = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, "utf8")) : {};
  const fresh = new Set<string>();
  const now = new Date().toISOString();
  for (const b of bounties) {
    if (!seen[b.url]) {
      fresh.add(b.url);
      seen[b.url] = now;
    }
  }
  mkdirSync(dirname(seenPath), { recursive: true });
  writeFileSync(seenPath, JSON.stringify(seen, null, 2));
  return fresh;
}

export function writeReports(
  ranked: ScoredBounty[],
  meta: ReportMeta,
  outDir: string,
  top: number,
  fresh: Set<string> = new Set(),
): { md: string; html: string; json: string } {
  mkdirSync(outDir, { recursive: true });
  const shortlist = ranked.filter((b) => !b.excluded).slice(0, top);

  const json = join(outDir, "bounties.json");
  writeFileSync(
    json,
    JSON.stringify(
      {
        ...meta,
        shortlist: shortlist.map(slim),
        excluded: ranked.filter((b) => b.excluded).map((b) => ({ url: b.url, reason: b.excluded })),
      },
      null,
      2,
    ),
  );

  const md = join(outDir, "report.md");
  writeFileSync(md, toMarkdown(shortlist, meta, ranked.length, fresh));

  const html = join(outDir, "index.html");
  writeFileSync(html, toHtml(ranked, meta, top, fresh));
  return { md, html, json };
}

function slim(b: ScoredBounty) {
  return {
    url: b.url,
    repo: b.repo,
    title: b.title,
    amountUsd: b.amountUsd,
    score: b.score,
    breakdown: b.breakdown,
    reasons: b.reasons,
    redFlags: b.redFlags,
    attempts: b.attempts,
    openClaims: b.openClaims,
    language: b.repoInfo?.language ?? null,
    stars: b.repoInfo?.stargazers_count ?? null,
    updatedAt: b.updatedAt,
  };
}

const money = (n: number | null) => (n === null ? "?" : `$${n.toLocaleString("en-US")}`);

export function toMarkdown(list: ScoredBounty[], meta: ReportMeta, scanned: number, fresh: Set<string>): string {
  const lines = [
    `# Bounty Scout report`,
    ``,
    `Generated ${meta.generatedAt.slice(0, 16).replace("T", " ")} UTC · ${scanned} issues scanned · ${list.length} worth a look`,
    ``,
    `| # | Score | Bounty | Issue | Why | ⚠ |`,
    `|---|------:|-------:|-------|-----|---|`,
  ];
  list.forEach((b, i) => {
    const isNew = fresh.has(b.url) ? " 🆕" : "";
    const title = b.title.replace(/\|/g, "\\|").slice(0, 80);
    lines.push(
      `| ${i + 1} | ${b.score} | ${money(b.amountUsd)} | [${b.repo}#${b.number}](${b.url}) ${title}${isNew} | ${b.reasons.join(" · ")} | ${b.redFlags.join("; ")} |`,
    );
  });
  lines.push(
    ``,
    `> Drafts are suggestions. Read the issue, check the contributing rules, and only open a PR you understand and stand behind.`,
  );
  return lines.join("\n") + "\n";
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function toHtml(ranked: ScoredBounty[], meta: ReportMeta, top: number, fresh: Set<string>): string {
  const active = ranked.filter((b) => !b.excluded).slice(0, top);
  const excluded = ranked.filter((b) => b.excluded);
  const total = active.reduce((s, b) => s + (b.amountUsd ?? 0), 0);

  const bar = (v: number) => `<span class="bar"><i style="width:${Math.round(v * 100)}%"></i></span>`;
  const card = (b: ScoredBounty, i: number) => `
  <article class="card${b.redFlags.length ? " flagged" : ""}" data-text="${esc(
    (b.title + " " + b.repo + " " + (b.repoInfo?.language ?? "")).toLowerCase(),
  )}">
    <div class="rank">${i + 1}</div>
    <div class="main">
      <h3><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a>${
        fresh.has(b.url) ? ' <span class="pill new">new</span>' : ""
      }</h3>
      <p class="meta">${esc(b.repo)}#${b.number} · ${
        b.repoInfo
          ? `${esc(b.repoInfo.language ?? "—")} · ${b.repoInfo.stargazers_count.toLocaleString("en-US")}★`
          : "repo details not loaded"
      } · updated ${b.updatedAt.slice(0, 10)}</p>
      <p class="why">${b.reasons.map(esc).join(" · ")}</p>
      ${b.redFlags.length ? `<p class="flags">⚠ ${b.redFlags.map(esc).join(" · ")}</p>` : ""}
      <details><summary>Score breakdown</summary>
        <dl>${Object.entries(b.breakdown)
          .map(([k, v]) => `<dt>${k}</dt><dd>${bar(v)}</dd>`)
          .join("")}</dl>
        <code>bounty-scout draft ${esc(b.url)}</code>
      </details>
    </div>
    <div class="side"><div class="amount">${money(b.amountUsd)}</div><div class="score">${b.score}<small>/100</small></div></div>
  </article>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bounty Scout — weekly report</title>
<style>
  :root { --bg:#0e1116; --panel:#161b22; --line:#2a313c; --text:#e6edf3; --muted:#8b949e; --accent:#3fb950; --warn:#d29922; --link:#58a6ff; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f8fa; --panel:#fff; --line:#d0d7de; --text:#1f2328; --muted:#59636e; --accent:#1a7f37; --warn:#9a6700; --link:#0969da; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }
  header, main, footer { max-width: 980px; margin: 0 auto; padding: 0 20px; }
  header { padding-top: 40px; }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.02em; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .stats { display:grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:24px; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .stat b { display:block; font-size:24px; font-variant-numeric: tabular-nums; }
  .stat span { color:var(--muted); font-size:13px; }
  .tools { display:flex; gap:12px; align-items:center; margin-bottom:16px; flex-wrap:wrap; }
  input[type=search] { flex:1; min-width:220px; padding:10px 12px; border-radius:8px; border:1px solid var(--line); background:var(--panel); color:var(--text); font:inherit; }
  .card { display:grid; grid-template-columns: 36px 1fr auto; gap:14px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:12px; }
  .card.flagged { border-color: var(--warn); }
  .rank { color:var(--muted); font-weight:600; font-variant-numeric: tabular-nums; padding-top:2px; }
  h3 { margin:0; font-size:16px; } h3 a { color:var(--link); text-decoration:none; } h3 a:hover { text-decoration:underline; }
  .meta, .why { margin:4px 0 0; color:var(--muted); font-size:13px; }
  .why { color: var(--text); }
  .flags { margin:6px 0 0; color:var(--warn); font-size:13px; }
  .side { text-align:right; min-width:90px; }
  .amount { font-size:20px; font-weight:700; color:var(--accent); font-variant-numeric: tabular-nums; }
  .score { font-size:14px; color:var(--muted); } .score small { font-size: 11px; }
  .pill { font-size:11px; padding:2px 7px; border-radius:99px; vertical-align:middle; }
  .pill.new { background: var(--accent); color: #fff; }
  details { margin-top:8px; font-size:13px; } summary { cursor:pointer; color:var(--muted); }
  dl { display:grid; grid-template-columns: 110px 1fr; gap:4px 10px; margin:8px 0; } dt { color:var(--muted); } dd { margin:0; align-self:center; }
  .bar { display:block; height:6px; background:var(--line); border-radius:3px; overflow:hidden; } .bar i { display:block; height:100%; background:var(--accent); }
  code { display:inline-block; margin-top:6px; padding:4px 8px; border-radius:6px; background:var(--bg); border:1px solid var(--line); font-size:12px; word-break:break-all; }
  .excluded { color:var(--muted); font-size:13px; } .excluded li { margin:2px 0; } .excluded a { color: var(--muted); }
  footer { color:var(--muted); font-size:13px; padding: 24px 20px 48px; }
  @media (max-width: 600px) { .card { grid-template-columns: 1fr; } .rank { display:none; } .side { text-align:left; display:flex; gap:12px; align-items:baseline; } }
</style>
</head>
<body>
<header>
  <h1>🔭 Bounty Scout</h1>
  <p class="sub">Open-source bounties ranked by value, stack fit, competition and trust · generated ${esc(
    meta.generatedAt.slice(0, 16).replace("T", " "),
  )} UTC</p>
  <section class="stats">
    <div class="stat"><b>${meta.scanned}</b><span>issues scanned</span></div>
    <div class="stat"><b>${active.length}</b><span>worth a look</span></div>
    <div class="stat"><b>${fresh.size ? active.filter((b) => fresh.has(b.url)).length : 0}</b><span>new this run</span></div>
    <div class="stat"><b>${money(total)}</b><span>on the table (shortlist)</span></div>
  </section>
</header>
<main>
  <div class="tools"><input type="search" id="q" placeholder="Filter by repo, language or words in the title…" aria-label="Filter"></div>
  <section id="list">${active.map(card).join("")}</section>
  <details class="excluded"><summary>${excluded.length} filtered out</summary><ul>${excluded
    .slice(0, 300)
    .map((b) => `<li><a href="${esc(b.url)}">${esc(b.repo)}#${b.number}</a> — ${esc(b.excluded ?? "")}</li>`)
    .join("")}</ul></details>
</main>
<footer>Drafts are suggestions, never auto-submitted. Read the issue and the project's contributing rules, and only open a PR you understand. · bounty-scout</footer>
<script>
  const q = document.getElementById('q');
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    document.querySelectorAll('#list .card').forEach(c => { c.style.display = !v || c.dataset.text.includes(v) ? '' : 'none'; });
  });
</script>
</body>
</html>
`;
}
