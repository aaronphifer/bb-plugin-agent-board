// Pure helper tests for board-model and the watch relevance decisions.
import { describe, expect, it } from "vitest";
import {
  BOARD_LIMITS,
  cardElapsedMs,
  columnForStatus,
  countCards,
  formatElapsed,
  isActivityEventType,
  isReasoningEventType,
  previewText,
  publicUpdatePreview,
} from "@/lib/board-model";
import { isRelevantThreadChange } from "@/lib/watch";
import type { BoardCard } from "@/contract/rpc";

function card(status: BoardCard["status"], kind: BoardCard["kind"] = "thread"): BoardCard {
  return {
    key: "k",
    parentKey: null,
    depth: 0,
    kind,
    source: "bb",
    title: "Card",
    subtitle: null,
    status,
    column: columnForStatus(status, kind),
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
    waitingOn: null,
    planStatus: null,
    isRoot: false,
  };
}

describe("columnForStatus", () => {
  it("routes live statuses to their columns", () => {
    expect(columnForStatus("queued", "thread")).toBe("plan");
    expect(columnForStatus("starting", "thread")).toBe("plan");
    expect(columnForStatus("waiting", "thread")).toBe("plan");
    expect(columnForStatus("running", "thread")).toBe("active");
    expect(columnForStatus("completed", "thread")).toBe("output");
    expect(columnForStatus("failed", "thread")).toBe("output");
    expect(columnForStatus("interrupted", "thread")).toBe("output");
    expect(columnForStatus("skipped", "thread")).toBe("output");
  });

  it("keeps plan steps in the plan column regardless of status", () => {
    expect(columnForStatus("running", "plan-step")).toBe("plan");
    expect(columnForStatus("completed", "plan-step")).toBe("plan");
  });
});

describe("countCards", () => {
  it("counts by status and ignores plan steps", () => {
    const counts = countCards([
      card("running"),
      card("waiting"),
      card("queued"),
      card("completed"),
      card("failed"),
      card("interrupted"),
      card("running", "plan-step"),
    ]);
    expect(counts).toEqual({
      running: 1,
      waiting: 1,
      queued: 1,
      completed: 1,
      failed: 1,
      interrupted: 1,
    });
  });
});

describe("previewText", () => {
  it("collapses whitespace", () => {
    expect(previewText("a\n  b\tc", 100)).toBe("a b c");
  });
  it("returns null for empty input", () => {
    expect(previewText("  \n\t ", 100)).toBeNull();
    expect(previewText(null, 100)).toBeNull();
  });
  it("truncates long output to the cap with an ellipsis", () => {
    const out = previewText("x".repeat(500), 240);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(240);
    expect(out!.endsWith("…")).toBe(true);
    expect(BOARD_LIMITS.outputPreviewChars).toBe(240);
  });
});

describe("formatElapsed", () => {
  it("renders compact durations", () => {
    expect(formatElapsed(42_000)).toBe("42s");
    expect(formatElapsed(102_000)).toBe("1m 42s");
    expect(formatElapsed(7_290_000)).toBe("2h 01m");
    expect(formatElapsed(-5)).toBe("0s");
  });
});

describe("cardElapsedMs", () => {
  const now = 1_000_000;
  it("prefers the authoritative duration when the work finished", () => {
    const c = card("completed");
    c.durationMs = 5_000;
    c.startedAt = 0;
    c.completedAt = 9_000;
    expect(cardElapsedMs(c, now)).toBe(5_000);
  });
  it("uses completedAt − startedAt when there is no duration", () => {
    const c = card("completed");
    c.startedAt = 100;
    c.completedAt = 1_100;
    expect(cardElapsedMs(c, now)).toBe(1_000);
  });
  it("clocks live work against now", () => {
    const c = card("running");
    c.startedAt = 400_000;
    expect(cardElapsedMs(c, now)).toBe(600_000);
  });
  it("returns null when no timing is known", () => {
    expect(cardElapsedMs(card("queued"), now)).toBeNull();
  });
});

describe("reasoning exclusion", () => {
  it("refuses reasoning event types", () => {
    expect(isReasoningEventType("item/reasoning/textDelta")).toBe(true);
    expect(isReasoningEventType("item/reasoning/summaryTextDelta")).toBe(true);
    expect(isReasoningEventType("item/reasoning/someNewKind")).toBe(true);
  });
  it("never treats reasoning as board activity", () => {
    expect(isActivityEventType("item/reasoning/textDelta")).toBe(false);
    expect(isActivityEventType("item/reasoning/summaryTextDelta")).toBe(false);
    expect(isActivityEventType("item/started")).toBe(true);
    expect(isActivityEventType("item/completed")).toBe(true);
    expect(isActivityEventType("item/agentMessage/delta")).toBe(false);
  });
  it("filters reasoning-only changed signals", () => {
    expect(
      isRelevantThreadChange({
        entity: "thread",
        type: "changed",
        id: "t1",
        changes: ["events-appended"],
        metadata: { eventTypes: ["item/reasoning/textDelta"] },
      }),
    ).toBe(false);
    expect(
      isRelevantThreadChange({
        entity: "thread",
        type: "changed",
        id: "t1",
        changes: ["status-changed"],
      }),
    ).toBe(true);
  });
});

describe("isRelevantThreadChange", () => {
  it("ignores cosmetic change kinds entirely", () => {
    for (const change of [
      "read-state-changed",
      "order-changed",
      "pin-state-changed",
      "tabs-changed",
      "terminals-changed",
      "environment-changed",
    ]) {
      expect(
        isRelevantThreadChange({ entity: "thread", type: "changed", id: "t1", changes: [change] }),
      ).toBe(false);
    }
  });
  it("stays conservative on unknown kinds and missing fields", () => {
    expect(
      isRelevantThreadChange({ entity: "thread", type: "changed", id: "t1", changes: ["brand-new"] }),
    ).toBe(true);
    expect(isRelevantThreadChange({ entity: "thread", type: "changed" })).toBe(true);
  });
  it("does not skip an append that also carried real events", () => {
    expect(
      isRelevantThreadChange({
        entity: "thread",
        type: "changed",
        id: "t1",
        changes: ["events-appended"],
        metadata: { eventTypes: ["item/reasoning/textDelta", "item/completed"] },
      }),
    ).toBe(true);
  });
});
describe("publicUpdatePreview", () => {
  it("returns null for empty, whitespace-only, and missing prose", () => {
    expect(publicUpdatePreview(null)).toBeNull();
    expect(publicUpdatePreview(undefined)).toBeNull();
    expect(publicUpdatePreview("")).toBeNull();
    expect(publicUpdatePreview("   \n\t  ")).toBeNull();
  });

  it("keeps ordinary assistant prose", () => {
    expect(publicUpdatePreview("The fix is ready; all 258 tests pass.")).toBe(
      "The fix is ready; all 258 tests pass.",
    );
  });

  it("truncates to the 360-char public-update bound", () => {
    const long = "x".repeat(1_000);
    const result = publicUpdatePreview(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(BOARD_LIMITS.publicUpdateChars);
  });

  it("strips closed code fences, keeping surrounding prose", () => {
    const text = [
      "Here is the plan:",
      "```ts",
      "export const x: number = 42;",
      "```",
      "Ship it.",
    ].join("\n");
    expect(publicUpdatePreview(text)).toBe("Here is the plan: Ship it.");
  });

  it("strips an unclosed fence (a turn interrupted mid-code)", () => {
    const text = "Status first:\n```bash\nsleep 20";
    expect(publicUpdatePreview(text)).toBe("Status first:");
  });

  it("drops a fence-only message entirely (null), never leaking code", () => {
    expect(publicUpdatePreview("```ts\nconst secret = 'abc';\n```")).toBeNull();
    expect(publicUpdatePreview("```\nsk_live_DEADBEEF\n```")).toBeNull();
  });

  it("redacts secret-bearing prose like every other global text", () => {
    const result = publicUpdatePreview("Deployed with api_key=abc123 for the demo tenant.");
    expect(result).not.toContain("abc123");
    expect(result).not.toBeNull();
  });

  it("collapses line breaks so the excerpt stays 2–3 rendered lines", () => {
    const result = publicUpdatePreview("Line one.\nLine two.\n\nLine three.");
    expect(result).toBe("Line one. Line two. Line three.");
  });
});
