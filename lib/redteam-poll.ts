// Conservative fallback for SDK 0.4.21, which has cross-plugin RPC but no
// supported cross-plugin realtime subscription. Polls only after an active
// Redteam scan has been discovered for a board or global page that a client
// is watching; the read's watched signal ends polling when the view closes.
export interface RedteamPollDeps {
  poll: (projectId: string) => Promise<{ changed: boolean; active: boolean }>;
  changed: (projectId: string) => void;
  pollGlobal?: () => Promise<{ changed: boolean; active: boolean }>;
  changedGlobal?: () => void;
  intervalMs?: number;
}

export class RedteamActivePoller {
  private readonly projects = new Map<string, Set<string>>();
  private readonly watchedRoots = new Map<string, number>();
  private readonly inflight = new Set<string>();
  private globalWatchers = 0;
  private globalActive = false;
  private globalInflight = false;
  private timer: ReturnType<typeof setInterval> | null = null; private disposed = false;

  constructor(private readonly deps: RedteamPollDeps) {
    this.timer = setInterval(() => { void this.tick(); }, deps.intervalMs ?? 3_000);
    if (typeof this.timer === "object" && this.timer !== null && "unref" in this.timer) (this.timer as unknown as { unref(): void }).unref();
  }

  /** Keep a board's root eligible for polling until its watched read ends. */
  watch(rootThreadId: string, signal: AbortSignal): void {
    if (this.disposed || signal.aborted) return;
    this.watchedRoots.set(rootThreadId, (this.watchedRoots.get(rootThreadId) ?? 0) + 1);
    signal.addEventListener("abort", () => {
      const count = (this.watchedRoots.get(rootThreadId) ?? 0) - 1;
      if (count > 0) { this.watchedRoots.set(rootThreadId, count); return; }
      this.watchedRoots.delete(rootThreadId);
      for (const [projectId, roots] of this.projects) { roots.delete(rootThreadId); if (roots.size === 0) this.projects.delete(projectId); }
    }, { once: true });
  }

  /** Keep the global page eligible for polling until its watched read ends. */
  watchGlobal(signal: AbortSignal): void {
    if (this.disposed || signal.aborted) return;
    this.globalWatchers += 1;
    signal.addEventListener("abort", () => {
      this.globalWatchers = Math.max(0, this.globalWatchers - 1);
      if (this.globalWatchers === 0) this.globalActive = false;
    }, { once: true });
  }

  observe(rootThreadId: string, projectId: string | null, active: boolean): void {
    if (this.disposed || !projectId) return;
    if (!active || !this.watchedRoots.has(rootThreadId)) {
      const roots = this.projects.get(projectId); roots?.delete(rootThreadId); if (roots?.size === 0) this.projects.delete(projectId); return;
    }
    const roots = this.projects.get(projectId) ?? new Set<string>(); roots.add(rootThreadId); this.projects.set(projectId, roots);
  }

  /** Track a watched global page only while it has an active Redteam scan. */
  observeGlobal(active: boolean): void {
    if (this.disposed || this.globalWatchers === 0) return;
    this.globalActive = active;
  }

  /** One bounded polling pass; public as a deterministic test seam. */
  async tick(): Promise<void> {
    if (this.disposed) return; const tasks: Promise<void>[] = [];
    for (const [projectId, roots] of this.projects) {
      if (roots.size === 0) { this.projects.delete(projectId); continue; }
      if (this.inflight.has(projectId)) continue;
      this.inflight.add(projectId);
      const task = this.deps.poll(projectId).then((result) => {
        if (result.changed) this.deps.changed(projectId);
        if (!result.active) this.projects.delete(projectId);
      }).catch(() => { /* optional source failure: retry only while previously active */ }).finally(() => this.inflight.delete(projectId));
      tasks.push(task);
    }
    if (this.globalWatchers > 0 && this.globalActive && !this.globalInflight && this.deps.pollGlobal) {
      this.globalInflight = true;
      const task = this.deps.pollGlobal().then((result) => {
        if (result.changed) this.deps.changedGlobal?.();
        if (this.globalWatchers > 0) this.globalActive = result.active;
      }).catch(() => {
        // Optional source failures never affect BB work; the page's slow
        // discovery refresh will reconcile availability.
      }).finally(() => { this.globalInflight = false; });
      tasks.push(task);
    }
    await Promise.all(tasks);
  }

  isPolling(projectId: string): boolean { return this.projects.has(projectId); }
  isGlobalPolling(): boolean { return this.globalActive && this.globalWatchers > 0; }
  dispose(): void { this.disposed = true; if (this.timer !== null) clearInterval(this.timer); this.timer = null; this.projects.clear(); this.watchedRoots.clear(); this.inflight.clear(); this.globalWatchers = 0; this.globalActive = false; this.globalInflight = false; }
}
