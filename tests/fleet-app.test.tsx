// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  loadPluginApp,
  renderSlot,
  type CapturedPluginApp,
  type RenderedSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { fleetCard, addFleetGroups } from "../lib/fleet-source";
import { buildGlobalDashboard } from "../lib/global-model";
import { job, wire, parent, group, scoped, NOW } from "./fleet-fixtures";
let app: CapturedPluginApp;
const slots: RenderedSlot[] = [];
beforeEach(async () => {
  app = await loadPluginApp(() => import("../app"));
});
afterEach(() => {
  for (const s of slots.splice(0)) s.unmount();
});
function board(jobs = [job()]) {
  const snapshot = scoped([parent(), ...jobs.map(fleetCard)]);
  const s = renderSlot(
    { component: app.threadPanelActions[0].component },
    { threadId: "parent", params: null } as never,
    { rpc: { board_snapshot: () => snapshot } },
  );
  slots.push(s);
  return s;
}
function global(jobs = [job()]) {
  const data = buildGlobalDashboard(addFleetGroups([group()], wire(jobs)), {
    now: NOW,
  });
  const s = renderSlot(
    { component: app.navPanels[0].component },
    { subPath: "" } as never,
    { rpc: { global_dashboard: () => data } },
  );
  slots.push(s);
  return s;
}
describe("Fleet worker presentation", () => {
  it("single worker focus shows delegated label, actual model and server", async () => {
    const s = board();
    await s.findByText("CURRENT DELEGATED WORK");
    expect(s.getByText("qwen3-coder:30b")).toBeTruthy();
    expect(s.getByText("Desktop PC")).toBeTruthy();
    expect(s.getByText("Generating response")).toBeTruthy();
  });
  it("multiple workers render individual live Kanban cards", async () => {
    const s = board([
      job(),
      job({ jobId: "j2", label: "Validation review B" }),
    ]);
    await s.findByTestId("kanban-board");
    expect(
      s.container.querySelectorAll(
        '[data-card-source="ollama-fleet"][data-live-state="executing"]',
      ),
    ).toHaveLength(2);
    expect(s.queryByTestId("single-agent-focus")).toBeNull();
  });
  it.each(["completed", "failed", "cancelled"] as const)(
    "worker %s remains visible and loses live animation",
    async (state) => {
      const s = board([
        job({
          state,
          errorPreview: state === "failed" ? "Generation failed" : null,
        }),
        job({ jobId: "j2", label: "Validation review B" }),
      ]);
      await s.findByText("Validation review B");
      expect(s.container.textContent).toContain("Validation review A");
      if (state === "failed")
        expect(s.container.textContent).toContain("Generation failed");
    },
  );
  it("Fleet LIVE strip remains static under reduced motion", async () => {
    const { BoardCardView } = await import("../components/board/board-card-view");
    const React = await import("react");
    const s = renderSlot(
      {
        component: () =>
          React.createElement(BoardCardView, {
            card: fleetCard(job()),
            now: NOW,
            liveTreatment: true,
            reducedMotion: true,
          }),
      },
      {} as never,
      {},
    );
    slots.push(s);
    expect(s.getByTestId("kanban-live-strip").className).toContain(
      "ab-strip-static",
    );
    expect(s.getByTestId("kanban-live-indicator").textContent).toContain(
      "Live",
    );
  });
  it("global compact list is capped at four, shows overflow, and stays shrinkable", async () => {
    const s = global(
      Array.from({ length: 8 }, (_, i) =>
        job({
          jobId: String(i),
          label: ("Worker" + i).repeat(20).slice(0, 120),
          actualModel: "m".repeat(120),
        }),
      ),
    );
    await s.findByText("+4 more");
    expect(s.container.querySelectorAll("[data-fleet-worker]")).toHaveLength(4);
    const el = s.container.querySelector('[data-part="delegated-workers"]')!;
    expect(el.className).toContain("min-w-0");
    expect(el.className).toContain("max-w-full");
    expect(el.querySelector(".line-clamp-2")?.className).toContain(
      "[overflow-wrap:anywhere]",
    );
  });
  it("orphan card shows Fleet, actual model/server and LIVE", async () => {
    const s = global([job({ origin: null })]);
    await s.findByText("Validation review A");
    const card = s.container.querySelector('[data-source="ollama-fleet"]')!;
    expect(card.textContent).toContain("Desktop PC");
    expect(card.textContent).toContain("qwen3-coder:30b");
    expect(card.getAttribute("data-live-state")).toBe("executing");
  });
  it("Fleet timeline targets job ID, never an invented BB thread", async () => {
    const { timelineTargetForCard } = await import("../components/timeline/execution-timeline-dialog");
    expect(
      timelineTargetForCard(fleetCard(job({ origin: null }))),
    ).toMatchObject({ source: "ollama-fleet", jobId: "j1" });
  });
  it("route results and prompts never appear in worker view", async () => {
    const s = global([
      {
        ...job(),
        prompt: "PRIVATE_PROMPT",
        response: "PRIVATE_RESPONSE",
        reasoning: "PRIVATE_REASONING",
      } as never,
    ]);
    await s.findByText("Parent work");
    expect(s.container.textContent).not.toMatch(/PRIVATE_/);
  });
});
