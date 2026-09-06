// @vitest-environment jsdom
// Reduced-motion accessibility: when the OS requests reduced motion the
// focus view must carry data-motion="reduced" so the CSS kill-switch strips
// every animation. Kept in its own file because the media-query cache is
// module state: a poisoned entry from an earlier test would mask the stub.
import { describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot, type CapturedPluginApp, type RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { BoardCard, BoardSnapshot } from "@/contract/rpc";

let app: CapturedPluginApp;

async function loadApp() {
  app = await loadPluginApp(() => import("../app"));
}

function card(kind: BoardCard["kind"], title: string, overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    key: `key-${title}`,
    parentKey: null,
    depth: 0,
    kind,
    source: "redteam",
    title,
    subtitle: null,
    status: "queued",
    column: "plan",
    threadId: null,
    providerId: null,
    providerLabel: null,
    model: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    phaseTitle: null,
    promptPreview: null,
    activity: null,
    outputPreview: null,
    errorPreview: null,
    tokens: null,
    toolCalls: null,
    waitingOn: "Not started",
    planStatus: null,
    isRoot: false,
    ...overrides,
  };
}

function scanFocusSnapshot(): BoardSnapshot {
  return {
    root: {
      threadId: "thr_root",
      title: "Authorized scan",
      status: "idle",
      displayStatus: null,
      providerId: null,
      providerLabel: null,
      model: null,
      projectId: null,
      createdAt: 0,
      updatedAt: 1000,
      goal: null,
      contextWindowUsedTokens: null,
      contextWindowTotalTokens: null,
    },
    counts: { running: 1, waiting: 0, queued: 2, completed: 1, failed: 0, interrupted: 0 },
    cards: [
      card("phase", "Reconnaissance", {
        key: "redteam:scan-1:reconnaissance",
        status: "completed",
        column: "output",
        scanId: "scan-1",
        groupKey: "redteam:scan-1",
        sequence: 0,
        phaseId: "reconnaissance",
        durationMs: 3000,
      }),
      card("phase", "Code review", {
        key: "redteam:scan-1:code-review",
        status: "running",
        column: "active",
        scanId: "scan-1",
        groupKey: "redteam:scan-1",
        sequence: 1,
        phaseId: "code-review",
        activity: { text: "Reading src/dispatcher.js", at: 950, kind: "read_file" },
      }),
      card("phase", "Web testing", {
        key: "redteam:scan-1:web-testing",
        scanId: "scan-1",
        groupKey: "redteam:scan-1",
        sequence: 2,
        phaseId: "web-testing",
      }),
    ],
    activityFeeds: [],
    partial: false,
    fetchedAt: 1000,
  };
}

function mountBoard(options: Parameters<typeof renderSlot>[2] = {}): RenderedSlot {
  const registration = app.threadPanelActions[0]!;
  return renderSlot(
    { component: registration.component },
    { threadId: "thr_root", params: null } as never,
    options,
  );
}

describe("reduced motion", () => {
  it("stamps both focus and Kanban live treatments as reduced motion", async () => {
    // jsdom has no matchMedia: install a reduced-motion user before mount
    // so the media-query cache is created with a truthful mql.
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    await loadApp();
    const slot = mountBoard({ rpc: { board_snapshot: () => scanFocusSnapshot() } });

    const focus = await slot.findByTestId("single-agent-focus");
    expect(focus.getAttribute("data-motion")).toBe("reduced");

    slot.unmount();

    const kanban = scanFocusSnapshot();
    kanban.cards.push(
      card("phase", "Second code review", {
        key: "redteam:scan-2:code-review",
        status: "running",
        column: "active",
        scanId: "scan-2",
        groupKey: "redteam:scan-2",
        sequence: 1,
        phaseId: "code-review",
      }),
    );
    kanban.counts.running = 2;
    const kanbanSlot = mountBoard({ rpc: { board_snapshot: () => kanban } });
    const kanbanBoard = await kanbanSlot.findByTestId("kanban-board");
    expect(kanbanBoard.getAttribute("data-motion")).toBe("reduced");
    expect(kanbanSlot.getAllByTestId("kanban-live-strip")).toHaveLength(2);
    for (const strip of kanbanSlot.getAllByTestId("kanban-live-strip")) {
      expect(strip.classList.contains("ab-strip-static")).toBe(true);
    }
    for (const indicator of kanbanSlot.getAllByTestId("kanban-live-indicator")) {
      expect(indicator.querySelector(".ab-live-dot")).toBeNull();
    }

    kanbanSlot.unmount();
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
  }, 15_000); // Includes the cold app import; keep assertions unchanged on slower hosts.

  it("stamps data-motion=full for users without the preference", async () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    await loadApp();
    const slot = mountBoard({ rpc: { board_snapshot: () => scanFocusSnapshot() } });

    const focus = await slot.findByTestId("single-agent-focus");
    expect(focus.getAttribute("data-motion")).toBe("full");

    slot.unmount();
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
  });
});
