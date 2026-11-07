// bb-plugin-agent-board — a BB plugin backend entry.
//
// The default export is a factory that receives the plugin API. The board is
// derived observability: on each board_snapshot request it fans out to
// bb.sdk (bounded), normalizes what BB reports into BoardCards, and returns
// a snapshot. Sources remain authoritative; only attention/release dismissal
// preferences are durable. Collection and watcher state are ephemeral caches.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { boardChangedTags, GLOBAL_DASHBOARD_TAG, rpcContract } from "./contract/rpc";
import { BoardCollector } from "./lib/collect";
import { attachWatcher, BoardWatcher } from "./lib/watch";
import { FleetActivePoller } from "./lib/fleet-poll";
import { RedteamActivePoller } from "./lib/redteam-poll";
import { DismissalStore, attentionDismissalKey } from "./lib/dismissals";
import { ReleaseAnnouncementStore } from "./lib/releases";

export { BOARD_CHANGED_CHANNEL } from "./contract/rpc";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const collector = new BoardCollector(bb);
  // Presentation-only attention dismissals (one bounded kv row in bb.db,
  // surviving plugin reloads; never mutates any underlying source state).
  const dismissals = new DismissalStore(bb.storage.kv);
  const releases = new ReleaseAnnouncementStore(bb.storage.kv);
  const watcher = new BoardWatcher({
    publish: (payload) => {
      collector.invalidate();
      bb.rpc.experimental_invalidate(boardChangedTags(payload));
      bb.realtime.publish(BoardWatcher.channel, payload);
    },
    getAncestors: createAncestorLoader(bb),
  });
  const redteamPoller = new RedteamActivePoller({
    poll: (projectId) => collector.pollRedteam(projectId),
    changed: (projectId) => {
      collector.invalidate();
      watcher.invalidateProject(projectId);
    },
    pollGlobal: () => collector.pollGlobalRedteam(),
    changedGlobal: () => {
      collector.invalidate();
      watcher.invalidateGlobal();
    },
  });

  const fleetPoller = new FleetActivePoller({
    poll: () => collector.pollFleet(),
    changed: () => {
      collector.invalidate(false);
      // Empty roots without global-only marks all scoped and global views stale.
      const payload = { roots: [] };
      bb.rpc.experimental_invalidate(boardChangedTags(payload));
      bb.realtime.publish(BoardWatcher.channel, payload);
    },
  });

  /** Feed the watcher and pollers what one board snapshot observed. */
  const observeBoard = (threadId: string, snapshot: Awaited<ReturnType<BoardCollector["snapshot"]>>) => {
    // The observed tree lets change signals be attributed to open boards
    // (ephemeral, rebuilt every fetch).
    const observed = [
      threadId,
      ...[...new Set(snapshot.cards.map((card) => card.threadId).filter((id) => id !== null))],
    ];
    watcher.touch(threadId, observed, snapshot.root.projectId);
    redteamPoller.observe(
      threadId,
      snapshot.root.projectId,
      collector.isRedteamActive(snapshot.root.projectId),
    );
    fleetPoller.observe(collector.isFleetActive());
  };

  // BB threads/workflows/plans/delegations plus optional adapter cards share
  // one source-discriminated normalized contract.
  bb.rpc.register(rpcContract, {
    release_announcement: () => releases.snapshot(),
    dismiss_release_announcement: ({ version }) => releases.dismiss(version),
    board_snapshot: async ({ threadId, fresh }) => {
      const snapshot = await collector.snapshot(threadId, { fresh });
      observeBoard(threadId, snapshot);
      return snapshot;
    },
    board_activity: ({ threadId, limit }) => collector.activity(threadId, limit),
    execution_timeline: async (input) => {
      const result = await collector.executionTimeline(input);
      fleetPoller.observe(collector.isFleetActive());
      return result;
    },
    global_dashboard: async ({ fresh }) => {
      const dismissedKeys = await dismissals.keys();
      const snapshot = await collector.globalDashboard({ fresh, dismissedKeys });
      redteamPoller.observeGlobal(collector.isGlobalRedteamActive());
      fleetPoller.observe(collector.isFleetActive());
      return { ...snapshot, monitoring: watcher.health() };
    },
    dismiss_attention: async ({ executionKey, type, updatedAt }) => {
      const dismissed = await dismissals.dismiss(
        attentionDismissalKey({ executionKey, type, updatedAt }),
      );
      // Only the global snapshot changed; per-thread caches stay warm.
      collector.invalidateGlobal();
      bb.rpc.experimental_invalidate([GLOBAL_DASHBOARD_TAG]);
      return { dismissed };
    },
    clear_dismissed_attentions: async () => {
      await dismissals.clear();
      collector.invalidateGlobal();
      bb.rpc.experimental_invalidate([GLOBAL_DASHBOARD_TAG]);
      return { dismissed: 0 };
    },
  });

  // A board or global page counts as open while a client watches its read:
  // the host aborts the signal when the last client leaves or hides the tab.
  bb.rpc.experimental_whileWatched("board_snapshot", async (read, signal) => {
    if (!("input" in read)) return;
    const input = rpcContract.board_snapshot.input.safeParse(read.input);
    if (!input.success) return;
    const { threadId } = input.data;
    watcher.watch(threadId, signal);
    redteamPoller.watch(threadId, signal);
    fleetPoller.watch(signal);
    try {
      const snapshot = await collector.snapshot(threadId);
      if (!signal.aborted) observeBoard(threadId, snapshot);
    } catch {
      // The read itself reports the failure; the next successful read observes.
    }
  });
  bb.rpc.experimental_whileWatched("global_dashboard", (_read, signal) => {
    watcher.watchGlobal(signal);
    redteamPoller.watchGlobal(signal);
    fleetPoller.watch(signal);
    redteamPoller.observeGlobal(collector.isGlobalRedteamActive());
    fleetPoller.observe(collector.isFleetActive());
    // BB lifecycle events are immediate. This slow check exists only to
    // discover a new Redteam run, whose changes cannot be subscribed to
    // cross-plugin.
    const discovery = setInterval(() => bb.rpc.experimental_invalidate([GLOBAL_DASHBOARD_TAG]), GLOBAL_DISCOVERY_INTERVAL_MS);
    signal.addEventListener("abort", () => clearInterval(discovery), { once: true });
  });

  // Invalidate open boards on real BB changes (coalesced, no polling).
  const unsubscribe = attachWatcher(bb, watcher);

  // The `bb agent-board` command: what agents (and you) use from a shell.
  bb.cli.register({
    name: "agent-board",
    summary: "Inspect the Agent Board observability snapshot for a thread tree",
    commands: [
      { name: "show", summary: "Render the board for a thread", usage: "bb agent-board show <thread-id> [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return {
            exitCode: 0,
            stdout: "Usage: bb agent-board show <thread-id> [--json]",
          };
        case "show": {
          const threadId = args[0];
          if (threadId === undefined || args.length !== 1) {
            return { exitCode: 1, stderr: "Usage: bb agent-board show <thread-id> [--json]" };
          }
          const snapshot = await collector.snapshot(threadId, { fresh: true });
          if (json) return { exitCode: 0, stdout: JSON.stringify(snapshot) };
          return { exitCode: 0, stdout: renderText(snapshot) };
        }
        default:
          return {
            exitCode: 1,
            stderr: `Unknown command "${command}". Usage: bb agent-board show <thread-id> [--json]`,
          };
      }
    },
  });

  // Cleanup on reload/disable/shutdown; hooks run LIFO. The sanctioned place
  // to clear timers and close connections.
  bb.onDispose(() => {
    unsubscribe();
    redteamPoller.dispose();
    fleetPoller.dispose();
    watcher.dispose();
    bb.log.info("disposed");
  });
}

const GLOBAL_DISCOVERY_INTERVAL_MS = 20_000;
const ANCESTOR_BATCH_LIMIT = 200;

/**
 * Batch ancestor lookups made in the same tick into one
 * `experimental_listAncestors` call (200 ids per request). A failed or
 * omitted lookup resolves to no ancestors.
 */
function createAncestorLoader(bb: BbPluginApi): (threadId: string) => Promise<readonly string[]> {
  let pending = new Map<string, Array<(ancestors: readonly string[]) => void>>();
  let scheduled = false;
  const flush = async () => {
    scheduled = false;
    const batch = pending;
    pending = new Map();
    const ids = [...batch.keys()];
    const ancestorsById = new Map<string, readonly string[]>();
    for (let start = 0; start < ids.length; start += ANCESTOR_BATCH_LIMIT) {
      try {
        const result = await bb.sdk.threads.experimental_listAncestors({
          threadIds: ids.slice(start, start + ANCESTOR_BATCH_LIMIT),
        });
        for (const entry of result.threads) ancestorsById.set(entry.threadId, entry.ancestorIds);
      } catch {
        // Unresolvable threads are treated as outside every watched tree.
      }
    }
    for (const [id, resolvers] of batch) {
      for (const resolve of resolvers) resolve(ancestorsById.get(id) ?? []);
    }
  };
  return (threadId) =>
    new Promise((resolve) => {
      const resolvers = pending.get(threadId);
      if (resolvers) resolvers.push(resolve);
      else pending.set(threadId, [resolve]);
      if (!scheduled) {
        scheduled = true;
        setTimeout(() => void flush(), 0);
      }
    });
}

/** Compact text rendering of a snapshot for CLI use. */
function renderText(
  snapshot: Awaited<ReturnType<BoardCollector["snapshot"]>>,
): string {
  const lines: string[] = [];
  lines.push(
    `Board: ${snapshot.root.title ?? snapshot.root.threadId}`,
  );
  if (snapshot.root.goal) lines.push(`Goal: ${snapshot.root.goal.objective}`);
  if (snapshot.root.model) lines.push(`Model: ${snapshot.root.providerLabel ?? snapshot.root.providerId} · ${snapshot.root.model}`);
  lines.push(
    `Cards: ${snapshot.cards.length} (running ${snapshot.counts.running}, queued ${snapshot.counts.queued}, waiting ${snapshot.counts.waiting}, done ${snapshot.counts.completed}, failed ${snapshot.counts.failed}, interrupted ${snapshot.counts.interrupted})${snapshot.partial ? " — tree truncated" : ""}`,
  );
  for (const card of snapshot.cards) {
    const badge = card.source === "redteam" ? "R" : card.kind === "thread" ? "T" : card.kind === "workflow-agent" ? "W" : card.kind === "delegation" ? "D" : card.kind === "plan-step" ? "P" : "Q";
    const meta = [card.providerLabel ?? card.providerId, card.model]
      .filter((value): value is string => value !== null && value !== undefined)
      .join(" · ");
    const parts = [
      `[${badge}]`,
      card.title,
      card.status,
      meta || undefined,
      card.phaseTitle ?? undefined,
      card.activity?.text ?? undefined,
    ].filter((part): part is string => part !== undefined && part !== null);
    lines.push(`${"  ".repeat(card.depth)}${parts.join(" / ")}`);
  }
  return lines.join("\n");
}
