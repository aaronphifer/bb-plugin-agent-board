// Conservative fallback for SDK 0.4.21, which has cross-plugin RPC but no
// supported cross-plugin realtime subscription. Polls only after an active
// Redteam scan has been discovered for an open board.
export interface RedteamPollDeps {
  poll: (projectId: string) => Promise<{ changed: boolean; active: boolean }>;
  changed: (projectId: string) => void;
  pollGlobal?: () => Promise<{ changed: boolean; active: boolean }>;
  changedGlobal?: () => void;
  now?: () => number;
  intervalMs?: number;
  watchedTtlMs?: number;
}

export class RedteamActivePoller {
  private readonly projects = new Map<string, Map<string, number>>();
  private readonly inflight = new Set<string>();
  private globalTouchedAt: number | null = null;
  private globalActive = false;
  private globalInflight = false;
  private readonly now: () => number; private readonly watchedTtlMs: number;
  private timer: ReturnType<typeof setInterval> | null = null; private disposed = false;

  constructor(private readonly deps: RedteamPollDeps) {
    this.now = deps.now ?? (() => Date.now()); this.watchedTtlMs = deps.watchedTtlMs ?? 90_000;
    this.timer = setInterval(() => { void this.tick(); }, deps.intervalMs ?? 3_000);
    if (typeof this.timer === "object" && this.timer !== null && "unref" in this.timer) (this.timer as unknown as { unref(): void }).unref();
  }

  observe(rootThreadId: string, projectId: string | null, active: boolean): void {
    if (this.disposed || !projectId) return;
    if (!active) {
      const roots = this.projects.get(projectId); roots?.delete(rootThreadId); if (roots?.size === 0) this.projects.delete(projectId); return;
    }
    const roots = this.projects.get(projectId) ?? new Map<string, number>(); roots.set(rootThreadId, this.now()); this.projects.set(projectId, roots);
  }

  /** Track an open global page only while it has an active Redteam scan. */
  observeGlobal(active: boolean): void {
    if (this.disposed) return;
    this.globalTouchedAt = this.now();
    this.globalActive = active;
  }

  /** One bounded polling pass; public as a deterministic test seam. */
  async tick(): Promise<void> {
    if (this.disposed) return; const now = this.now(); const tasks: Promise<void>[] = [];
    for (const [projectId, roots] of this.projects) {
      for (const [rootId, touchedAt] of roots) if (now - touchedAt > this.watchedTtlMs) roots.delete(rootId);
      if (roots.size === 0) { this.projects.delete(projectId); continue; }
      if (this.inflight.has(projectId)) continue;
      this.inflight.add(projectId);
      const task = this.deps.poll(projectId).then((result) => {
        if (result.changed) this.deps.changed(projectId);
        if (!result.active) this.projects.delete(projectId);
      }).catch(() => { /* optional source failure: retry only while previously active */ }).finally(() => this.inflight.delete(projectId));
      tasks.push(task);
    }
    if (
      this.globalTouchedAt !== null &&
      now - this.globalTouchedAt <= this.watchedTtlMs &&
      this.globalActive &&
      !this.globalInflight &&
      this.deps.pollGlobal
    ) {
      this.globalInflight = true;
      const task = this.deps.pollGlobal().then((result) => {
        if (result.changed) this.deps.changedGlobal?.();
        this.globalActive = result.active;
      }).catch(() => {
        // Optional source failures never affect BB work; the page's slow
        // discovery refresh will reconcile availability.
      }).finally(() => { this.globalInflight = false; });
      tasks.push(task);
    } else if (this.globalTouchedAt !== null && now - this.globalTouchedAt > this.watchedTtlMs) {
      this.globalTouchedAt = null;
      this.globalActive = false;
    }
    await Promise.all(tasks);
  }

  isPolling(projectId: string): boolean { return this.projects.has(projectId); }
  isGlobalPolling(): boolean { return this.globalActive && this.globalTouchedAt !== null; }
  dispose(): void { this.disposed = true; if (this.timer !== null) clearInterval(this.timer); this.timer = null; this.projects.clear(); this.inflight.clear(); this.globalTouchedAt = null; this.globalActive = false; this.globalInflight = false; }
}
