// Exactly one active-only loop, independent of job/parent count, running only
// while a client watches a board or the global page. Idle discovery belongs to
// the global page's 20-second refresh and ordinary BB changes.
export class FleetActivePoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight = false;
  private disposed = false;
  private active = false;
  private watchers = 0;
  constructor(
    private deps: {
      poll: () => Promise<{ changed: boolean; active: boolean }>;
      changed: () => void;
    },
  ) {}
  /** Allow polling until the watched read's signal aborts. */
  watch(signal: AbortSignal) {
    if (this.disposed || signal.aborted) return;
    this.watchers += 1;
    signal.addEventListener("abort", () => {
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers > 0) return;
      this.active = false;
      this.stop();
    }, { once: true });
  }
  observe(active: boolean) {
    if (this.disposed || this.watchers === 0) return;
    // Preserve one scheduled tick to publish a terminal result another view
    // discovered before the poll. The tick consumes the shared cache and stops.
    if (!active && this.active && (this.timer || this.inflight)) return;
    this.active = active;
    if (active) this.schedule();
    else this.stop();
  }
  private stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private schedule() {
    if (this.timer || this.inflight || this.disposed || !this.active) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, 2500);
    this.timer.unref?.();
  }
  async tick() {
    if (this.inflight || this.disposed || !this.active || this.watchers === 0) return;
    this.inflight = true;
    try {
      const result = await this.deps.poll();
      if (this.disposed || this.watchers === 0) return;
      this.active = result.active;
      if (result.changed) this.deps.changed();
    } catch {
      this.active = false;
    } finally {
      this.inflight = false;
      if (this.active) this.schedule();
      else this.stop();
    }
  }
  dispose() {
    this.disposed = true;
    this.active = false;
    this.stop();
  }
}
