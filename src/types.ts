export interface Weights {
  amount: number;
  stack: number;
  competition: number;
  trust: number;
  freshness: number;
  clarity: number;
}

export interface Config {
  queries: string[];
  maxIssuesPerQuery: number;
  updatedWithinDays: number;
  stack: { languages: string[]; keywords: string[] };
  minAmountUsd: number;
  minStars: number;
  maxAttempts: number;
  maxPerRepo: number;
  excludeLabels: string[];
  redFlagKeywords: string[];
  weights: Weights;
  report: { top: number; outDir: string };
  draft: { workDir: string; outDir: string; allowShell: boolean; extraClaudeArgs: string[] };
}

/** Raw issue as returned by the GitHub search API (only the fields we use). */
export interface GhIssue {
  html_url: string;
  repository_url: string;
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  comments: number;
  created_at: string;
  updated_at: string;
  assignees?: { login: string }[];
  author_association?: string;
  pull_request?: unknown;
}

export interface GhRepo {
  full_name: string;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  archived: boolean;
  fork: boolean;
  created_at: string;
  pushed_at: string;
  topics?: string[];
}

export interface GhComment {
  user: { login: string } | null;
  body: string;
  created_at: string;
}

/** Everything we know about one bounty after enrichment. */
export interface Bounty {
  url: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  assigned: boolean;
  amountUsd: number | null;
  attempts: number;
  openClaims: number;
  repoInfo: GhRepo | null;
  /** How many bounty issues this repo has in the current scan (spam-farm signal). */
  repoBountyCount: number;
}

export interface ScoreBreakdown {
  amount: number;
  stack: number;
  competition: number;
  trust: number;
  freshness: number;
  clarity: number;
}

export interface ScoredBounty extends Bounty {
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  redFlags: string[];
  excluded: string | null;
}
