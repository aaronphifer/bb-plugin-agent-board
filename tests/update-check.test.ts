import { describe, expect, it, vi } from "vitest";
import { ReleaseUpdateChecker, newerStableVersion } from "../lib/update-check";

function checker(overrides: Record<string, unknown> = {}) {
  const fetchLatest = vi.fn(async () => ({ tag_name: "v0.8.0", draft: false, prerelease: false }));
  const checkNative = vi.fn(async () => ({ outcome: "current" }));
  const applyNative = vi.fn(async () => ({ applied: true, outcome: "updated" }));
  return { fetchLatest, checkNative, applyNative, checker: new ReleaseUpdateChecker({ installed: "0.7.0", fetchLatest, checkNative, applyNative, now: () => 1000, ...overrides } as never) };
}
describe("release awareness and supported updates", () => {
  it("only accepts newer stable versions", () => {
    expect(newerStableVersion("v0.8.0", "0.7.0")).toBe("0.8.0");
    for (const tag of ["v0.7.0", "v0.6.9", "v0.8.0-rc.1", "weird", "v0.8.0/path"]) expect(newerStableVersion(tag, "0.7.0")).toBeNull();
  });
  it("coalesces requests and advertises out-of-range releases without installing", async () => {
    const c = checker();
    const results = await Promise.all([c.checker.snapshot(), c.checker.snapshot()]);
    expect(results[0]).toMatchObject({ latest: "0.8.0", eligible: null, releaseUrl: "https://github.com/aaronphifer/bb-plugin-agent-board/releases/tag/v0.8.0" });
    expect(c.fetchLatest).toHaveBeenCalledTimes(1);
    expect(c.applyNative).not.toHaveBeenCalled();
  });
  it("refuses an unreviewed or no-longer-eligible update", async () => {
    const c = checker();
    await expect(c.checker.install("old-candidate")).rejects.toThrow();
    expect(c.applyNative).not.toHaveBeenCalled();
  });
  it("applies eligible updates through BB without removing the plugin", async () => {
    const c = checker({ checkNative: async () => ({ outcome: "update-available", candidate: { version: "sha-08", display: "repo@v0.8.0" } }) });
    expect((await c.checker.snapshot()).eligible?.version).toBe("sha-08");
    await c.checker.install("sha-08");
    expect(c.applyNative).toHaveBeenCalledTimes(1);
  });
  it("retains native eligibility if public release discovery is unavailable", async () => {
    const c = checker({ fetchLatest: async () => { throw Error("rate limit"); }, checkNative: async () => ({ outcome: "update-available", candidate: { version: "sha-07", display: "repo@v0.7.1" } }) });
    expect(await c.checker.snapshot()).toMatchObject({ latest: null, eligible: { version: "sha-07" }, discoveryUnavailable: true });
  });
});
