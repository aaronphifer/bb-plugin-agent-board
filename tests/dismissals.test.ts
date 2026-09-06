// Attention-dismissal store: stable condition keys, kv persistence across
// plugin reloads, hard bounds, and fail-open reads. Pure presentation state.
import { describe, expect, it } from "vitest";
import {
  DISMISSAL_LIMITS,
  DismissalStore,
  attentionDismissalKey,
  type KvLike,
} from "@/lib/dismissals";

class FakeKv implements KvLike {
  readonly rows = new Map<string, unknown>();
  failRead = false;

  async get<T>(key: string): Promise<T | undefined> {
    if (this.failRead) throw new Error("kv read failed");
    return this.rows.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.rows.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }
  async list(prefix?: string): Promise<string[]> {
    return [...this.rows.keys()].filter((key) => prefix === undefined || key.startsWith(prefix));
  }
}

const condition = {
  executionKey: "bb:thr_auth",
  type: "failed" as const,
  updatedAt: 1_700_000_000_000,
};

describe("attentionDismissalKey", () => {
  it("keys an unchanged condition identically across re-derivation", () => {
    // Same execution, same type, same source updatedAt → same key.
    expect(attentionDismissalKey(condition)).toBe(attentionDismissalKey({ ...condition }));
    expect(attentionDismissalKey(condition)).toBe("bb:thr_auth::failed::1700000000000");
  });

  it("distinguishes type and condition version on the same execution", () => {
    expect(attentionDismissalKey({ ...condition, type: "waiting" as const })).not.toBe(
      attentionDismissalKey(condition),
    );
    expect(attentionDismissalKey({ ...condition, updatedAt: 1_700_000_001_234 })).not.toBe(
      attentionDismissalKey(condition),
    );
  });
});

describe("DismissalStore", () => {
  it("persists dismissals across reload (a fresh store sees them)", async () => {
    const kv = new FakeKv();
    const first = new DismissalStore(kv, () => 100);
    await first.dismiss(attentionDismissalKey(condition));

    // A new plugin load over the same storage still sees the dismissal.
    const reloaded = new DismissalStore(kv, () => 200);
    expect(await reloaded.count()).toBe(1);
    expect(await reloaded.keys()).toEqual(new Set([attentionDismissalKey(condition)]));

    // ...and clear() removes it for the next load too.
    await reloaded.clear();
    expect(await new DismissalStore(kv, () => 300).count()).toBe(0);
    expect(kv.rows.has(DISMISSAL_LIMITS.storageKey)).toBe(false);
  });

  it("is idempotent: dismissing the same condition twice keeps one entry", async () => {
    const kv = new FakeKv();
    const store = new DismissalStore(kv, () => 100);
    expect(await store.dismiss(attentionDismissalKey(condition))).toBe(1);
    expect(await store.dismiss(attentionDismissalKey(condition))).toBe(1);
    expect(await store.count()).toBe(1);
  });

  it("stores everything in exactly one bounded kv row", async () => {
    const kv = new FakeKv();
    const store = new DismissalStore(kv, () => 100);
    await store.dismiss("a::failed::1");
    await store.dismiss("b::waiting::2");
    expect(kv.rows.size).toBe(1);
    expect(kv.rows.has(DISMISSAL_LIMITS.storageKey)).toBe(true);
    expect(await kv.list("attention")).toEqual([DISMISSAL_LIMITS.storageKey]);
  });

  it("evicts the oldest dismissals beyond the cap", async () => {
    const kv = new FakeKv();
    const store = new DismissalStore(kv, () => 100);
    for (let i = 0; i < DISMISSAL_LIMITS.maxEntries + 3; i += 1) {
      await store.dismiss(`exec:${i}::failed::1`);
    }
    expect(await store.count()).toBe(DISMISSAL_LIMITS.maxEntries);
    const keys = await store.keys();
    expect(keys.has("exec:0::failed::1")).toBe(false); // oldest evicted
    expect(keys.has("exec:1::failed::1")).toBe(false);
    expect(keys.has("exec:2::failed::1")).toBe(false);
    expect(keys.has(`exec:${DISMISSAL_LIMITS.maxEntries + 2}::failed::1`)).toBe(true); // newest kept
  });

  it("acts empty (fail-open) when storage reads fail", async () => {
    const kv = new FakeKv();
    const store = new DismissalStore(kv, () => 100);
    await store.dismiss(attentionDismissalKey(condition));
    kv.failRead = true;
    expect(await store.count()).toBe(0);
    expect(await store.keys()).toEqual(new Set());
  });

  it("tolerates a corrupt row by acting empty", async () => {
    const kv = new FakeKv();
    kv.rows.set(DISMISSAL_LIMITS.storageKey, "not-an-object");
    const store = new DismissalStore(kv, () => 100);
    expect(await store.count()).toBe(0);
  });
});