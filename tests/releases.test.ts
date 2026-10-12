import { describe, it, expect } from "vitest";
import { CURRENT_RELEASE, ReleaseAnnouncementStore } from "../lib/releases";
import type { KvLike } from "../lib/dismissals";
function storage(initial: unknown = undefined) {
  const values = new Map<string, unknown>([["release-dismissals", initial]]);
  const kv: KvLike = { get: async <T>(key: string) => values.get(key) as T | undefined, set: async (key, value) => { values.set(key, value); }, delete: async key => { values.delete(key); }, list: async () => [...values.keys()] };
  return { kv, values };
}
describe("local versioned announcements", () => {
  it("shows stable notes after 0.6.1 or an RC while preserving prior dismissals", async () => {
    const previous = ["0.6.1", "0.6.2", "0.7.0-rc.1"];
    const { kv, values } = storage(previous);
    expect(CURRENT_RELEASE.version).toBe("0.7.0");
    const store = new ReleaseAnnouncementStore(kv);
    expect(await store.snapshot()).toMatchObject({ version: CURRENT_RELEASE.version, dismissed: false });
    await store.dismiss(CURRENT_RELEASE.version);
    expect((await new ReleaseAnnouncementStore(kv).snapshot()).dismissed).toBe(true);
    expect(values.get("release-dismissals")).toEqual([...previous, "0.7.0"]);
    const rc = new ReleaseAnnouncementStore(kv, { ...CURRENT_RELEASE, version: "0.7.0-rc.1" });
    expect((await rc.snapshot()).dismissed).toBe(true);
  });
  it.each([null, 42, "invalid", { dismissed: true }])("ignores non-array dismissal storage: %j", async value => {
    const { kv } = storage(value);
    expect((await new ReleaseAnnouncementStore(kv).snapshot()).dismissed).toBe(false);
  });
  it("shows a new version and persists dismissal across reload", async () => {
    const { kv } = storage(); const store = new ReleaseAnnouncementStore(kv);
    expect((await store.snapshot()).dismissed).toBe(false);
    await store.dismiss(CURRENT_RELEASE.version);
    expect((await new ReleaseAnnouncementStore(kv).snapshot()).dismissed).toBe(true);
  });
  it("a changed version appears, and downgrade remembers its own dismissal", async () => {
    const { kv } = storage(); const old = new ReleaseAnnouncementStore(kv, { ...CURRENT_RELEASE, version: "0.6.1" });
    await old.dismiss("0.6.1");
    const next = new ReleaseAnnouncementStore(kv);
    expect((await next.snapshot()).dismissed).toBe(false); await next.dismiss(CURRENT_RELEASE.version);
    expect((await old.snapshot()).dismissed).toBe(true); expect((await next.snapshot()).dismissed).toBe(true);
  });
  it("keeps notes available after dismissal and rejects stale-version writes", async () => {
    const { kv } = storage(); const store = new ReleaseAnnouncementStore(kv);
    await expect(store.dismiss("wrong-version")).rejects.toThrow("version changed");
    await store.dismiss(CURRENT_RELEASE.version); expect((await store.snapshot()).highlights.length).toBeGreaterThan(0);
  });
  it("surfaces read and write errors without pretending dismissal succeeded", async () => {
    const { kv } = storage(); kv.get = async () => { throw new Error("read failed"); };
    await expect(new ReleaseAnnouncementStore(kv).snapshot()).rejects.toThrow("read failed");
    const normal = storage(); normal.kv.set = async () => { throw new Error("write failed"); };
    const store = new ReleaseAnnouncementStore(normal.kv); await expect(store.dismiss(CURRENT_RELEASE.version)).rejects.toThrow("write failed"); expect((await store.snapshot()).dismissed).toBe(false);
  });
  it("handles malformed storage and bounds repeated/concurrent dismissals", async () => {
    const { kv, values } = storage([null, 42, "x".repeat(81), ...Array.from({ length: 40 }, (_, i) => `old-${i}`)]);
    const store = new ReleaseAnnouncementStore(kv); await Promise.all([store.dismiss(CURRENT_RELEASE.version), store.dismiss(CURRENT_RELEASE.version)]);
    const versions = values.get("release-dismissals") as string[]; expect(versions).toHaveLength(20); expect(versions.filter(v => v === CURRENT_RELEASE.version)).toHaveLength(1);
  });
});
