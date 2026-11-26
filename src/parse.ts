import type { GhComment } from "./types.js";

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?(?!\w|\.\d)/g;

function toUsd(num: string, k?: string): number {
  const n = Number(num.replace(/,/g, ""));
  return Number.isFinite(n) ? n * (k ? 1000 : 1) : NaN;
}

/** All dollar amounts in a string, e.g. "$150", "$1,500", "$8k". */
export function moneyValues(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const v = toUsd(m[1], m[2]);
    if (v > 0) out.push(v);
  }
  return out;
}

/** Dollar amounts that appear close to the word "bounty" (to skip unrelated prices). */
export function bountyAmountsInText(text: string, window = 60): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const start = Math.max(0, (m.index ?? 0) - window);
    const around = text.slice(start, (m.index ?? 0) + m[0].length + window).toLowerCase();
    if (around.includes("bounty") || around.includes("reward")) {
      const v = toUsd(m[1], m[2]);
      if (v > 0) out.push(v);
    }
  }
  return out;
}

/**
 * Best guess of the bounty value in USD.
 * Priority: amount labels ("$250") → bot/maintainer bounty comments → issue body.
 */
export function parseAmount(labels: string[], body: string, comments: GhComment[]): number | null {
  const fromLabels = labels.flatMap((l) => (/^\s*\$/.test(l) ? moneyValues(l) : []));
  if (fromLabels.length) return Math.max(...fromLabels);

  // Bounty platforms announce the real amount through their bot account.
  const fromBots = comments.filter(isBountyBot).flatMap((c) => bountyAmountsInText(c.body ?? ""));
  if (fromBots.length) return Math.max(...fromBots);

  // The issue itself (title + body) is written by the maintainer or sponsor.
  const fromBody = bountyAmountsInText(body);
  if (fromBody.length) return Math.max(...fromBody);

  // Other people's comments are the least trustworthy source: anyone can write "$5,000".
  const fromComments = comments.flatMap((c) => bountyAmountsInText(c.body ?? ""));
  if (fromComments.length) return Math.min(...fromComments);
  return null;
}

const BOT_LOGINS = new Set(["algora-pbc", "algora-pbc[bot]", "opire-bot", "opirebot", "issuehunt-app[bot]", "boss-bot"]);

export function isBountyBot(c: GhComment): boolean {
  const login = (c.user?.login ?? "").toLowerCase();
  return BOT_LOGINS.has(login) || (login.endsWith("[bot]") && /bount|algora|opire/.test(login));
}

const SCAM_PATTERNS: [RegExp, string][] = [
  [/(increase|top up|fund) the bounty by \$?\d/i, "asks contributors to pay to claim"],
  [/(pay|send|deposit) (a |the )?(fee|deposit|\$\d)/i, "asks for a payment"],
  [/prove you('| a)re not a bot/i, "fake 'prove you are human' step"],
  [/(dm|telegram|whatsapp) me (to|for) (claim|get) (the )?(reward|bounty)/i, "moves the claim to private chat"],
];

/** Comments that try to get money out of contributors — a classic bounty scam. */
export function scamSignals(comments: GhComment[]): string[] {
  const found = new Set<string>();
  for (const c of comments) {
    if (isBountyBot(c)) continue;
    for (const [re, label] of SCAM_PATTERNS) if (re.test(c.body ?? "")) found.add(label);
  }
  return [...found];
}

const PLAIN_ATTEMPT =
  /\b(i'?d like to (pick|take|work on)|i('| wi)ll (pick|take|work on)|i('| a)m (working|picking) (on|this)|can i (work on|take|pick)|(please )?assign (this|it) to me|i have (submitted|opened) a pull request)\b/i;

/** Distinct people who announced they are working on it ("/attempt #123" or in plain words). */
export function countAttempts(comments: GhComment[]): number {
  const users = new Set<string>();
  for (const c of comments) {
    if (isBountyBot(c)) continue;
    const body = c.body ?? "";
    if (/^\s*\/attempt\b/im.test(body) || PLAIN_ATTEMPT.test(body)) users.add(c.user?.login ?? "?");
  }
  return users.size;
}

const ELIGIBILITY: [RegExp, string][] = [
  [/\bU\.?S\.? citizens?\b|citizens? of the United States/i, "payout limited to US citizens"],
  [/\b(US|U\.S\.|United States) (residents?|persons?) only\b|must (reside|be located) in the (US|U\.S\.|United States)/i, "payout limited to US residents"],
  [/\b(KYC|identity verification) (is )?required\b/i, "identity verification required to get paid"],
];

/** Who can actually get paid — restrictions hidden in the issue or the thread. */
export function eligibilitySignals(body: string, comments: GhComment[]): string[] {
  const text = [body, ...comments.map((c) => c.body ?? "")].join("\n");
  return ELIGIBILITY.filter(([re]) => re.test(text)).map(([, label]) => label);
}

/** Pull requests already submitted to claim the bounty. */
export function countClaims(comments: GhComment[]): number {
  let n = 0;
  for (const c of comments) {
    const b = c.body ?? "";
    if (/submitted a pull request|\/claim\s+#?\d+|opened a pull request/i.test(b)) n++;
  }
  return n;
}

export function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}
