import type { GhComment, GhIssue, GhRepo } from "./types.js";

const API = "https://api.github.com";

export class GitHubClient {
  private repoCache = new Map<string, Promise<GhRepo | null>>();

  constructor(
    private token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
    private log: (msg: string) => void = (m) => process.stderr.write(m + "\n"),
  ) {}

  get authenticated(): boolean {
    return Boolean(this.token);
  }

  private async request<T>(path: string, attempt = 0): Promise<T> {
    const res = await fetch(path.startsWith("http") ? path : API + path, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "bounty-scout",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });

    const rateLimited =
      res.status === 429 ||
      (res.status === 403 &&
        (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")));
    if (rateLimited && attempt < 3) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      const retryAfter = Number(res.headers.get("retry-after") ?? 0) * 1000;
      const wait = Math.min(Math.max(retryAfter, reset - Date.now(), 5_000), 90_000);
      this.log(`  rate limited, waiting ${Math.round(wait / 1000)}s…`);
      await new Promise((r) => setTimeout(r, wait));
      return this.request<T>(path, attempt + 1);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub ${res.status} on ${path}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  /** Runs a search query and pages through results up to `max` issues. */
  async searchIssues(query: string, max: number): Promise<GhIssue[]> {
    const out: GhIssue[] = [];
    const perPage = Math.min(100, max);
    for (let page = 1; out.length < max && page <= 10; page++) {
      const q = encodeURIComponent(query);
      const data = await this.request<{ items: GhIssue[]; total_count: number }>(
        `/search/issues?q=${q}&sort=updated&order=desc&per_page=${perPage}&page=${page}`,
      );
      out.push(...data.items.filter((i) => !i.pull_request));
      if (data.items.length < perPage) break;
    }
    return out.slice(0, max);
  }

  repo(fullName: string): Promise<GhRepo | null> {
    let p = this.repoCache.get(fullName);
    if (!p) {
      p = this.request<GhRepo>(`/repos/${fullName}`).catch((e) => {
        this.log(`  could not load repo ${fullName}: ${(e as Error).message}`);
        return null;
      });
      this.repoCache.set(fullName, p);
    }
    return p;
  }

  issue(fullName: string, number: number): Promise<GhIssue> {
    return this.request<GhIssue>(`/repos/${fullName}/issues/${number}`);
  }

  async comments(fullName: string, number: number): Promise<GhComment[]> {
    try {
      return await this.request<GhComment[]>(
        `/repos/${fullName}/issues/${number}/comments?per_page=100`,
      );
    } catch (e) {
      this.log(`  could not load comments for ${fullName}#${number}: ${(e as Error).message}`);
      return [];
    }
  }
}

/** Run async work over items with a fixed concurrency. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function repoFromApiUrl(url: string): string {
  return url.replace(/^https:\/\/api\.github\.com\/repos\//, "");
}
