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

  const fromComments = comments.flatMap((c) => bountyAmountsInText(c.body ?? ""));
  if (fromComments.length) return Math.max(...fromComments);

  const fromBody = bountyAmountsInText(body);
  if (fromBody.length) return Math.max(...fromBody);
  return null;
}

/** Distinct people who announced they are working on it ("/attempt #123"). */
export function countAttempts(comments: GhComment[]): number {
  const users = new Set<string>();
  for (const c of comments) {
    if (/^\s*\/attempt\b/im.test(c.body ?? "")) users.add(c.user?.login ?? "?");
  }
  return users.size;
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
