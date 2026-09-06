import { describe, expect, it, vi } from "vitest";
import { RedteamActivePoller } from "@/lib/redteam-poll";

describe("active Redteam polling", () => {
  it("starts only after an active scan is observed and stops at terminal state", async () => {
    const poll = vi.fn().mockResolvedValueOnce({ changed: true, active: true }).mockResolvedValueOnce({ changed: true, active: false });
    const changed = vi.fn(); const poller = new RedteamActivePoller({ poll, changed, intervalMs: 60_000 });
    expect(poller.isPolling("p1")).toBe(false); poller.observe("thr-1", "p1", true); expect(poller.isPolling("p1")).toBe(true);
    await poller.tick(); expect(changed).toHaveBeenCalledWith("p1"); expect(poller.isPolling("p1")).toBe(true);
    await poller.tick(); expect(poller.isPolling("p1")).toBe(false); poller.dispose();
  });

  it("does not overlap slow requests for the same project", async () => {
    let release!: (value: { changed: boolean; active: boolean }) => void; const gate = new Promise<{ changed: boolean; active: boolean }>((resolve) => { release = resolve; });
    const poll = vi.fn(async () => gate); const poller = new RedteamActivePoller({ poll, changed: vi.fn(), intervalMs: 60_000 }); poller.observe("thr-1", "p1", true);
    const first = poller.tick(); const second = poller.tick(); expect(poll).toHaveBeenCalledTimes(1); release({ changed: false, active: true }); await Promise.all([first, second]); poller.dispose();
  });

  it("does not poll idle/completed scans and expires closed boards", async () => {
    let now = 0; const poll = vi.fn(async () => ({ changed: false, active: true })); const poller = new RedteamActivePoller({ poll, changed: vi.fn(), now: () => now, intervalMs: 60_000, watchedTtlMs: 100 });
    poller.observe("thr-1", "p1", false); await poller.tick(); expect(poll).not.toHaveBeenCalled();
    poller.observe("thr-1", "p1", true); now = 101; await poller.tick(); expect(poll).not.toHaveBeenCalled(); expect(poller.isPolling("p1")).toBe(false); poller.dispose();
  });

  it("dispose stops future activity", async () => {
    const poll = vi.fn(async () => ({ changed: false, active: true })); const poller = new RedteamActivePoller({ poll, changed: vi.fn(), intervalMs: 60_000 });
    poller.observe("thr-1", "p1", true); poller.dispose(); await poller.tick(); expect(poll).not.toHaveBeenCalled();
  });

  it("polls a globally observed active scan and stops at terminal state", async () => {
    const pollGlobal = vi.fn().mockResolvedValueOnce({ changed: true, active: true }).mockResolvedValueOnce({ changed: true, active: false });
    const changedGlobal = vi.fn();
    const poller = new RedteamActivePoller({ poll: vi.fn(), changed: vi.fn(), pollGlobal, changedGlobal, intervalMs: 60_000 });
    poller.observeGlobal(true);
    expect(poller.isGlobalPolling()).toBe(true);
    await poller.tick();
    expect(changedGlobal).toHaveBeenCalledTimes(1);
    await poller.tick();
    expect(poller.isGlobalPolling()).toBe(false);
    poller.dispose();
  });

  it("does not overlap global poll requests", async () => {
    let release!: (value: { changed: boolean; active: boolean }) => void;
    const gate = new Promise<{ changed: boolean; active: boolean }>((resolve) => { release = resolve; });
    const pollGlobal = vi.fn(async () => gate);
    const poller = new RedteamActivePoller({ poll: vi.fn(), changed: vi.fn(), pollGlobal, intervalMs: 60_000 });
    poller.observeGlobal(true);
    const first = poller.tick();
    const second = poller.tick();
    expect(pollGlobal).toHaveBeenCalledTimes(1);
    release({ changed: false, active: true });
    await Promise.all([first, second]);
    poller.dispose();
  });

  it("does not poll Redteam globally while no active scan is known", async () => {
    const pollGlobal = vi.fn(async () => ({ changed: false, active: false }));
    const poller = new RedteamActivePoller({ poll: vi.fn(), changed: vi.fn(), pollGlobal, intervalMs: 60_000 });
    poller.observeGlobal(false);
    await poller.tick();
    expect(pollGlobal).not.toHaveBeenCalled();
    poller.dispose();
  });
});
