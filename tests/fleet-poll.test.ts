import { afterEach, describe, it, expect, vi } from "vitest";
import { FleetActivePoller } from "../lib/fleet-poll";
afterEach(() => vi.useRealTimers());
function watched(poller: FleetActivePoller): AbortController {
  const controller = new AbortController();
  poller.watch(controller.signal);
  return controller;
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
describe("one bounded active Fleet loop", () => {
  it("has no idle timer or requests", async () => {
    vi.useFakeTimers();
    const poll = vi.fn();
    const p = new FleetActivePoller({ poll, changed: () => {} });
    watched(p);
    p.observe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(poll).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    p.dispose();
  });
  it("starts at 2.5 seconds and stops after completion", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue({ active: false, changed: true });
    const changed = vi.fn();
    const p = new FleetActivePoller({ poll, changed });
    watched(p);
    p.observe(true);
    await vi.advanceTimersByTimeAsync(2499);
    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20000);
    expect(poll).toHaveBeenCalledTimes(1);
    p.dispose();
  });
  it("publishes cached completion discovered by another view before stopping", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue({ active: false, changed: true });
    const changed = vi.fn();
    const p = new FleetActivePoller({ poll, changed });
    watched(p);
    p.observe(true);
    p.observe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    p.dispose();
  });
  it("multiple workers/views do not create multiple loops", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue({ active: true, changed: false });
    const p = new FleetActivePoller({ poll, changed: () => {} });
    watched(p);
    for (let i = 0; i < 20; i++) p.observe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(poll).toHaveBeenCalledTimes(4);
    p.dispose();
  });
  it("does not overlap a slow request", async () => {
    vi.useFakeTimers();
    let resolve!: (r: { active: boolean; changed: boolean }) => void;
    const poll = vi.fn(
      () =>
        new Promise<{ active: boolean; changed: boolean }>(
          (r) => (resolve = r),
        ),
    );
    const p = new FleetActivePoller({ poll, changed: () => {} });
    watched(p);
    p.observe(true);
    await vi.advanceTimersByTimeAsync(2500);
    for (let i = 0; i < 3; i++) {
      p.observe(true);
      void p.tick();
    }
    await vi.advanceTimersByTimeAsync(10000);
    expect(poll).toHaveBeenCalledTimes(1);
    resolve({ active: false, changed: true });
    await settle();
    p.dispose();
  });
  it("does not publish or restart after disposal midflight", async () => {
    vi.useFakeTimers();
    let resolve!: (r: { active: boolean; changed: boolean }) => void;
    const changed = vi.fn();
    const p = new FleetActivePoller({
      poll: () => new Promise((r) => (resolve = r)),
      changed,
    });
    watched(p);
    p.observe(true);
    await vi.advanceTimersByTimeAsync(2500);
    p.dispose();
    resolve({ active: true, changed: true });
    await settle();
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops when the last watched view closes", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue({ active: true, changed: false });
    const p = new FleetActivePoller({ poll, changed: () => {} });
    const board = watched(p);
    const page = watched(p);
    p.observe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(poll).toHaveBeenCalledTimes(1);
    board.abort();
    await vi.advanceTimersByTimeAsync(2500);
    expect(poll).toHaveBeenCalledTimes(2);
    page.abort();
    await vi.advanceTimersByTimeAsync(30000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    p.dispose();
  });
  it("ignores observations while no view is watched", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue({ active: true, changed: false });
    const p = new FleetActivePoller({ poll, changed: () => {} });
    p.observe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(poll).not.toHaveBeenCalled();
    p.dispose();
  });
  it("RPC errors stop active polling until ordinary discovery", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockRejectedValue(Error("offline"));
    const p = new FleetActivePoller({ poll, changed: () => {} });
    watched(p);
    p.observe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(poll).toHaveBeenCalledTimes(1);
    p.observe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(poll).toHaveBeenCalledTimes(2);
    p.dispose();
  });
});
