import type { Bounty, Config, ScoreBreakdown, ScoredBounty } from "./types.js";
import { daysBetween } from "./parse.js";

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lower = (s: string) => s.toLowerCase();

/** Hard filters: a bounty that fails one of these is not worth anyone's time. */
export function exclusionReason(b: Bounty, cfg: Config): string | null {
  const excluded = new Set(cfg.excludeLabels.map(lower));
  const hit = b.labels.find((l) => excluded.has(lower(l)));
  if (hit) return `label "${hit}"`;
  if (b.repoInfo?.archived) return "repository archived";
  if (b.assigned) return "already assigned";
  if (b.attempts > cfg.maxAttempts) return `${b.attempts} people already attempting`;
  if (b.amountUsd !== null && b.amountUsd < cfg.minAmountUsd) return `below $${cfg.minAmountUsd}`;
  if (b.repoInfo && b.repoInfo.stargazers_count < cfg.minStars) {
    return `repo has ${b.repoInfo.stargazers_count}★ (< ${cfg.minStars})`;
  }
  return null;
}

/** Signals that a bounty may be spam, a scam or a trap. They lower trust, they don't exclude. */
export function redFlags(b: Bounty, cfg: Config): string[] {
  const flags: string[] = [];
  const text = lower([b.title, b.body, ...b.labels].join(" "));
  for (const kw of cfg.redFlagKeywords) if (text.includes(lower(kw))) flags.push(`mentions "${kw}"`);

  const stars = b.repoInfo?.stargazers_count ?? 0;
  if (b.amountUsd !== null && b.amountUsd >= 2000 && stars < 200) {
    flags.push(`$${b.amountUsd} bounty on a ${stars}★ repo`);
  }
  const smallOrUnknown = !b.repoInfo || stars < 500;
  if (b.repoBountyCount >= 5 && smallOrUnknown) {
    flags.push(`${b.repoBountyCount} bounties from one ${b.repoInfo ? "small " : ""}repo (bounty farm?)`);
  }
  const repoName = b.repo.split("/")[1] ?? "";
  if (/bount(y|ies)|bug-?bounty|hunters?/i.test(repoName) && smallOrUnknown) {
    flags.push("repo exists only to host bounties");
  }
  if (b.repoInfo && daysBetween(b.repoInfo.created_at) < 30) flags.push("repo created < 30 days ago");
  return flags;
}

export function scoreBounty(b: Bounty, cfg: Config): ScoredBounty {
  const reasons: string[] = [];
  const flags = redFlags(b, cfg);

  // Amount: log scale, $2,000+ is a full mark.
  let amount: number;
  if (b.amountUsd === null) {
    amount = 0.15;
    reasons.push("amount not stated");
  } else {
    amount = clamp(Math.log10(b.amountUsd) / Math.log10(2000));
    reasons.push(`$${b.amountUsd.toLocaleString("en-US")}`);
  }

  // Stack fit: repo language plus keyword hits in the issue and repo topics.
  const langs = new Set(cfg.stack.languages.map(lower));
  const lang = b.repoInfo?.language ?? null;
  const langMatch = lang !== null && langs.has(lower(lang));
  const haystack = lower([b.title, b.body, ...b.labels, ...(b.repoInfo?.topics ?? [])].join(" "));
  const kwHits = cfg.stack.keywords.filter((k) => new RegExp(`\\b${escapeRe(lower(k))}\\b`).test(haystack));
  let stack = (langMatch ? 0.7 : 0) + Math.min(kwHits.length, 3) * 0.1;
  if (!langMatch && lang === null) stack += 0.2; // unknown language: don't punish too hard
  stack = clamp(stack);
  if (langMatch) reasons.push(lang!);
  if (kwHits.length) reasons.push(`matches ${kwHits.slice(0, 3).join(", ")}`);

  // Competition: fewer attempts and claims is better.
  const competition = clamp(1 - b.attempts * 0.25 - b.openClaims * 0.4);
  reasons.push(
    b.attempts + b.openClaims === 0
      ? "no one on it yet"
      : `${b.attempts} attempt(s), ${b.openClaims} PR claim(s)`,
  );

  // Trust: an established project pays; red flags cut deep.
  const stars = b.repoInfo?.stargazers_count ?? 0;
  let trust = clamp(Math.log10(stars + 1) / 4); // 10k★ = 1
  if (b.repoInfo?.fork) trust -= 0.3;
  trust = clamp(trust - flags.length * 0.4);
  if (b.repoInfo) reasons.push(`${stars.toLocaleString("en-US")}★`);

  // Freshness: recently active issues are still alive.
  const idle = daysBetween(b.updatedAt);
  let freshness = clamp(1 - Math.max(0, idle - 14) / Math.max(1, cfg.updatedWithinDays - 14));
  if (daysBetween(b.createdAt) > 365 && b.commentCount > 20) freshness = clamp(freshness - 0.3);

  // Clarity: a scoped, well-described issue is cheaper to solve.
  const len = b.body.length;
  let clarity = len < 80 ? 0.1 : len < 300 ? 0.4 : len < 6000 ? 0.7 : 0.5;
  if (/- \[ \]|acceptance criteria|steps to reproduce|expected|should\b|definition of done/i.test(b.body)) {
    clarity += 0.3;
  }
  clarity = clamp(clarity);

  const breakdown: ScoreBreakdown = { amount, stack, competition, trust, freshness, clarity };
  const w = cfg.weights;
  const totalWeight = w.amount + w.stack + w.competition + w.trust + w.freshness + w.clarity;
  const raw =
    amount * w.amount +
    stack * w.stack +
    competition * w.competition +
    trust * w.trust +
    freshness * w.freshness +
    clarity * w.clarity;
  let score = (raw / totalWeight) * 100;
  if (flags.length) score *= 0.6; // flagged bounties sink below clean ones

  return {
    ...b,
    score: Math.round(score),
    breakdown,
    reasons,
    redFlags: flags,
    excluded: exclusionReason(b, cfg),
  };
}

export function rank(bounties: Bounty[], cfg: Config): ScoredBounty[] {
  const sorted = bounties
    .map((b) => scoreBounty(b, cfg))
    .sort((a, b) => Number(a.excluded !== null) - Number(b.excluded !== null) || b.score - a.score);

  // Keep the shortlist diverse: at most `maxPerRepo` bounties from the same repository.
  const perRepo = new Map<string, number>();
  for (const b of sorted) {
    if (b.excluded) continue;
    const n = (perRepo.get(b.repo) ?? 0) + 1;
    perRepo.set(b.repo, n);
    if (n > cfg.maxPerRepo) b.excluded = `more than ${cfg.maxPerRepo} from this repo`;
  }
  return sorted.sort(
    (a, b) => Number(a.excluded !== null) - Number(b.excluded !== null) || b.score - a.score,
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
