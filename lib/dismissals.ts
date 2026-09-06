// bb-plugin-agent-board — presentation-only attention dismissal store.
//
// Dismissal hides an attention item from the global dashboard's "Needs
// attention" list. It never mutates any underlying state: BB threads, Redteam
// scans, approvals, failures and source adapters are untouched; the item
// stays visible in Active/Recent sections and returns automatically when the
// underlying condition genuinely changes.
//
// Identity: a dismissal is keyed by (executionKey, attention type, and the
// version of the underlying condition — the attention item's `updatedAt`,
// which is the source execution row's updatedAt). That version is stable
// across re-derivation of an unchanged condition (so it stays dismissed) but
// changes when the execution updates (new failure, new waiting reason, new
// message), so a genuinely new condition reappears.
//
// Persistence: one bounded JSON row in bb.storage.kv ("attention-dismissals"),
// a map of key → storedAt. The plugin keeps no other durable state.

import type { AttentionItem, AttentionType } from "../contract/rpc";

/** Minimal structural subset of bb.storage.kv, so tests can fake it. */
export interface KvLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

/** Hard bounds for the dismissal store. */
export const DISMISSAL_LIMITS = {
  /** Max stored dismissal keys (oldest storedAt evicted beyond the cap). */
  maxEntries: 200,
  /** Single kv row holding all dismissals. */
  storageKey: "attention-dismissals",
} as const;

export type DismissalMap = Record<string, number>; // key → storedAt

/** Stable identity of one dismissed attention condition. */
export function attentionDismissalKey(item: {
  executionKey: string;
  type: AttentionType;
  updatedAt: number;
}): string {
  return `${item.executionKey}::${item.type}::${item.updatedAt}`;
}

/** Prune to the cap, evicting the oldest stored entries first. */
export function pruneDismissals(entries: DismissalMap): DismissalMap {
  const keys = Object.keys(entries);
  if (keys.length <= DISMISSAL_LIMITS.maxEntries) return entries;
  const ordered = keys.sort((a, b) => entries[a]! - entries[b]!);
  const keep = ordered.slice(ordered.length - DISMISSAL_LIMITS.maxEntries);
  const out: DismissalMap = {};
  for (const key of keep) out[key] = entries[key]!;
  return out;
}

/**
 * Bounded dismissal store over one kv row. Every write re-reads the row (the
 * row is small; reads are a local sqlite hit), prunes to the cap, and writes
 * back — no long-lived mutable state, so concurrent plugin loads converge.
 */
export class DismissalStore {
  constructor(private readonly kv: KvLike, private readonly now: () => number = () => Date.now()) {}

  private async read(): Promise<DismissalMap> {
    try {
      const value = await this.kv.get<DismissalMap>(DISMISSAL_LIMITS.storageKey);
      return value && typeof value === "object" ? value : {};
    } catch {
      return {}; // unreadable storage: act empty rather than failing the board
    }
  }

  private async write(entries: DismissalMap): Promise<void> {
    await this.kv.set(DISMISSAL_LIMITS.storageKey, pruneDismissals(entries));
  }

  /** All currently dismissed keys. */
  async keys(): Promise<ReadonlySet<string>> {
    return new Set(Object.keys(await this.read()));
  }

  /** Store count (for RPC responses and tests). */
  async count(): Promise<number> {
    return Object.keys(await this.read()).length;
  }

  /** Dismiss one attention condition (idempotent). */
  async dismiss(key: string): Promise<number> {
    const entries = await this.read();
    entries[key] = this.now();
    await this.write(entries);
    return Object.keys(pruneDismissals(entries)).length;
  }

  /** Forget every dismissal. */
  async clear(): Promise<void> {
    await this.kv.delete(DISMISSAL_LIMITS.storageKey);
  }
}