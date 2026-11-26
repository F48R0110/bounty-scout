import type { Bounty, Config, GhIssue } from "./types.js";
import { GitHubClient, mapLimit, repoFromApiUrl } from "./github.js";
import { countAttempts, countClaims, parseAmount } from "./parse.js";

export interface ScanOptions {
  log?: (msg: string) => void;
  concurrency?: number;
  /** false = search results only (fast, 3 API calls); no repo stars, attempts or claims. */
  enrich?: boolean;
}

export async function scan(cfg: Config, gh: GitHubClient, opts: ScanOptions = {}): Promise<Bounty[]> {
  const log = opts.log ?? ((m: string) => process.stderr.write(m + "\n"));
  const since = new Date(Date.now() - cfg.updatedWithinDays * 86_400_000).toISOString().slice(0, 10);

  // 1. Collect candidate issues from every query, de-duplicated by URL.
  const byUrl = new Map<string, GhIssue>();
  for (const q of cfg.queries) {
    const query = `${q} updated:>=${since}`;
    log(`→ searching: ${query}`);
    try {
      const items = await gh.searchIssues(query, cfg.maxIssuesPerQuery);
      for (const it of items) byUrl.set(it.html_url, it);
      log(`  ${items.length} issues`);
    } catch (e) {
      log(`  search failed: ${(e as Error).message}`);
    }
  }
  const issues = [...byUrl.values()];

  // 2. How many bounties each repo has — a repo with dozens of tiny bounties is often a farm.
  const perRepo = new Map<string, number>();
  for (const i of issues) {
    const r = repoFromApiUrl(i.repository_url);
    perRepo.set(r, (perRepo.get(r) ?? 0) + 1);
  }

  // 3. Enrich with repo metadata and comments (amounts, attempts, claims).
  const excluded = new Set(cfg.excludeLabels.map((l) => l.toLowerCase()));
  if (opts.enrich ?? true) log(`→ enriching ${issues.length} issues from ${perRepo.size} repos`);
  return mapLimit(issues, opts.concurrency ?? 6, async (i) => {
    const repo = repoFromApiUrl(i.repository_url);
    const labels = i.labels.map((l) => l.name);
    const enrich = opts.enrich ?? true;
    const skipComments =
      !enrich || labels.some((l) => excluded.has(l.toLowerCase())) || i.comments === 0;
    const [repoInfo, comments] = await Promise.all([
      enrich ? gh.repo(repo) : Promise.resolve(null),
      skipComments ? Promise.resolve([]) : gh.comments(repo, i.number),
    ]);
    const body = i.body ?? "";
    return {
      url: i.html_url,
      repo,
      number: i.number,
      title: i.title,
      body,
      labels,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      commentCount: i.comments,
      assigned: (i.assignees?.length ?? 0) > 0,
      amountUsd: parseAmount(labels, `${i.title}\n${body}`, comments),
      attempts: countAttempts(comments),
      openClaims: countClaims(comments),
      repoInfo,
      repoBountyCount: perRepo.get(repo) ?? 1,
    } satisfies Bounty;
  });
}
