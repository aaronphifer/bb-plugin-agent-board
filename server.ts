// bb-plugin-agent-board — a BB plugin backend entry.
//
// The default export is a factory that receives the plugin API. The board is
// derived observability: on each board_snapshot request it fans out to
// bb.sdk (bounded), normalizes what BB reports into BoardCards, and returns
// a snapshot. BB is the only source of truth; the plugin keeps no durable
// state and only small ephemeral caches.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract/rpc";
import { BoardCollector } from "./lib/collect";
import { attachWatcher, BoardWatcher } from "./lib/watch";
import { FleetActivePoller } from "./lib/fleet-poll";
import { RedteamActivePoller } from "./lib/redteam-poll";
import { DismissalStore, attentionDismissalKey } from "./lib/dismissals";

export { BOARD_CHANGED_CHANNEL } from "./contract/rpc";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const collector = new BoardCollector(bb);
  // Presentation-only attention dismissals (one bounded kv row in bb.db,
  // surviving plugin reloads; never mutates any underlying source state).
  const dismissals = new DismissalStore(bb.storage.kv);
  const watcher = new BoardWatcher({
    publish: (payload) => {
      collector.invalidate();
      bb.realtime.publish(BoardWatcher.channel, payload);
    },
    getParent: async (threadId) => {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        return thread.parentThreadId ?? null;
      } catch {
        return null; // deleted or not visible to this plugin
      }
    },
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
      bb.realtime.publish(BoardWatcher.channel, { roots: [] });
    },
  });

  // BB threads/workflows/plans/delegations plus optional adapter cards share
  // one source-discriminated normalized contract.
  bb.rpc.register(rpcContract, {
    board_snapshot: async ({ threadId, fresh }) => {
      const snapshot = await collector.snapshot(threadId, { fresh });
      // Feed the watcher the observed tree so change signals can be
      // attributed to open boards (ephemeral, rebuilt every fetch).
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
      watcher.touchGlobal();
      redteamPoller.observeGlobal(collector.isGlobalRedteamActive());
      fleetPoller.observe(collector.isFleetActive());
      return snapshot;
    },
    dismiss_attention: async ({ executionKey, type, updatedAt }) => {
      const dismissed = await dismissals.dismiss(
        attentionDismissalKey({ executionKey, type, updatedAt }),
      );
      // Only the global snapshot changed; per-thread caches stay warm.
      collector.invalidateGlobal();
      return { dismissed };
    },
    clear_dismissed_attentions: async () => {
      await dismissals.clear();
      collector.invalidateGlobal();
      return { dismissed: 0 };
    },
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
