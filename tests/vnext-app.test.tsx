// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { phaseCard, phaseExecution, phaseSnapshot } from "./vnext-fixtures";
import { CURRENT_RELEASE } from "../lib/releases";
import { BOARD_CHANGED_CHANNEL } from "../contract/rpc";
let app: CapturedPluginApp;
beforeEach(async () => { app = await loadPluginApp(() => import("../app")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function mount(options: Parameters<typeof renderSlot>[2] = {}) {
  return renderSlot({ component: app.navPanels[0]!.component }, { subPath: "" } as never, { ...options, rpc: { global_dashboard: () => phaseSnapshot(), release_announcement: () => ({ ...CURRENT_RELEASE, dismissed: true }), ...options.rpc } });
}
describe("Phase 1 dashboard interactions", () => {
  it("surfaces native collection failures without calling the source live", async () => {
    const slot = mount({ rpc: { global_dashboard: () => phaseSnapshot({ active: [], unavailableSources: ["bb"] }) } });
    await slot.findByText("Native BB observation is unavailable. Refresh to retry; optional sources may still report.");
    expect(slot.getByRole("alert")).toBeTruthy(); slot.unmount();
  });
  it("filters/group sessions and keeps actionable attention visible", async () => {
    const attention = { id: "a", executionKey: "a", type: "failed" as const, status: "open" as const, title: "Urgent failure", message: "Review failure", firstObservedAt: 10, updatedAt: 20, threadId: "thread", source: "bb" as const };
    const b = phaseExecution("Task B", { projectId: "proj-b", projectName: "Project B", card: phaseCard({ title: "Task B", providerId: "grok", providerLabel: "Grok" }) });
    const slot = mount({ rpc: { global_dashboard: () => phaseSnapshot({ active: [phaseExecution("Task A"), b], attention: [attention] }) } });
    await slot.findByText("Task B");
    fireEvent.change(slot.getByLabelText("Filter by project"), { target: { value: "value:proj-a" } });
    expect(slot.queryByText("Task B")).toBeNull(); expect(slot.getByText("Task A")).toBeTruthy(); expect(slot.getByText("Urgent failure")).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Group sessions by"), { target: { value: "project" } });
    expect(slot.getByText("Project A (1)")).toBeTruthy();
    fireEvent.click(slot.getByText("Reset filters")); expect(slot.getByText("Task B")).toBeTruthy(); slot.unmount();
  });
  it("quiet reporting retains running state and the existing animated strip", async () => {
    const e = phaseExecution("Long build", { card: phaseCard({ title: "Long build", activity: { text: "Building", kind: "command", at: Date.now() - 600_000 } }) });
    const slot = mount({ rpc: { global_dashboard: () => phaseSnapshot({ active: [e] }) } });
    await slot.findByText("Long build"); expect(slot.container.querySelector('[data-freshness="quiet"]')?.textContent).toContain("task may still be running");
    expect(slot.getByTestId("kanban-live-strip")).toBeTruthy(); expect(slot.container.querySelector('[data-global-card="active"]')?.getAttribute("data-status")).toBe("running"); slot.unmount();
  });
  it("collapses empty attention and expands on actionable change", async () => {
    let result = phaseSnapshot(); const slot = mount({ rpc: { global_dashboard: () => result } });
    await slot.findByText("Task A"); expect(slot.container.querySelector("[data-empty-attention]")?.className).not.toContain("py-4");
    result = phaseSnapshot({ attention: [{ id: "a", executionKey: "a", type: "action-required", status: "open", title: "Approval", message: "Approve tool", firstObservedAt: 10, updatedAt: 20, threadId: "thread", source: "bb" }] });
    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: [], global: true }); await slot.findByText("Approve tool"); expect(slot.container.querySelector("[data-empty-attention]")).toBeNull(); slot.unmount();
  });
  it("shows watcher errors independently of transport and recovers on reconnect", async () => {
    const fetch = vi.fn(() => phaseSnapshot({ monitoring: { status: "degraded", startedAt: 1, lastEventAt: 2, lastPublishedAt: null, lastErrorAt: 3 } }));
    const slot = mount({ rpc: { global_dashboard: fetch } });
    await slot.findByText("Task A"); expect(slot.getByText("Connected")).toBeTruthy(); expect(slot.getByRole("alert").textContent).toContain("watcher has a problem");
    await slot.behavior.setRealtimeConnectionState("reconnecting"); expect(slot.getByText("Connection: reconnecting")).toBeTruthy();
    expect(slot.getByLabelText("Monitoring health").textContent).toContain("Watcher health unconfirmed");
    const calls = fetch.mock.calls.length; await slot.behavior.setRealtimeConnectionState("connected"); await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(calls)); slot.unmount();
  });
  it("qualifies cached watching health after a failed refresh even while connected", async () => {
    let fail = false;
    const slot = mount({ rpc: { global_dashboard: () => {
      if (fail) throw new Error("Synthetic refresh failure");
      return phaseSnapshot({ monitoring: { status: "watching", startedAt: 1, lastEventAt: null, lastPublishedAt: null, lastErrorAt: null } });
    } } });
    await slot.findByText("Task A");
    expect(slot.getByLabelText("Monitoring health").textContent).toContain("Watcher: watching");
    await waitFor(() => expect((slot.getByText("Refresh") as HTMLButtonElement).disabled).toBe(false));
    fail = true; fireEvent.click(slot.getByText("Refresh"));
    await slot.findByText(/Synthetic refresh failure/);
    expect(slot.getByText("Connected")).toBeTruthy();
    expect(slot.getByLabelText("Monitoring health").textContent).toContain("Watcher health unconfirmed");
    slot.unmount();
  });
  it("qualifies an overdue cached snapshot while a refresh remains pending", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const slot = mount({ rpc: { global_dashboard: () => ++calls === 1
      ? phaseSnapshot({ monitoring: { status: "watching", startedAt: 1, lastEventAt: null, lastPublishedAt: null, lastErrorAt: null } })
      : new Promise(() => {}) } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(slot.getByLabelText("Monitoring health").textContent).toContain("Watcher: watching");
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(slot.getByLabelText("Monitoring health").textContent).toContain("Refresh is overdue");
    expect(slot.getByLabelText("Monitoring health").textContent).toContain("Watcher health unconfirmed");
    slot.unmount();
  });
  it("labels reported verification and retains source-output access", async () => {
    const done = phaseExecution("Done", { card: phaseCard({ title: "Done", status: "completed", column: "output", outputPreview: "Result: UI updated\nTests: 15 passed" }) });
    const slot = mount({ rpc: { global_dashboard: () => phaseSnapshot({ active: [], recent: [done] }) } });
    await slot.findByText("Done"); expect(slot.getByText("Reported by the agent; not independently verified.")).toBeTruthy(); expect(slot.getByText("Original output preview")).toBeTruthy(); expect(slot.getByRole("button", { name: "Open Done" })).toBeTruthy(); slot.unmount();
  });
});
describe("release announcements in the dashboard", () => {
  it("dismisses and allows later viewing of the same notes", async () => {
    const dismiss = vi.fn(async () => ({ dismissed: true }));
    const slot = mount({ rpc: { release_announcement: () => ({ ...CURRENT_RELEASE, dismissed: false }), dismiss_release_announcement: dismiss } });
    await slot.findByRole("region", { name: "What's New" }); fireEvent.click(slot.getByText("Dismiss announcement"));
    await waitFor(() => expect(slot.queryByRole("region", { name: "What's New" })).toBeNull()); expect(dismiss).toHaveBeenCalledWith({ version: CURRENT_RELEASE.version });
    fireEvent.click(slot.getByText("Release notes")); expect(slot.getByRole("region", { name: "What's New" })).toBeTruthy(); slot.unmount();
  });
  it("keeps the announcement visible when persistence fails", async () => {
    const slot = mount({ rpc: { release_announcement: () => ({ ...CURRENT_RELEASE, dismissed: false }), dismiss_release_announcement: () => { throw new Error("storage unavailable"); } } });
    await slot.findByText("Dismiss announcement"); fireEvent.click(slot.getByText("Dismiss announcement")); await slot.findByText("Dismissal could not be saved. Please try again."); expect(slot.getByRole("region", { name: "What's New" })).toBeTruthy(); slot.unmount();
  });
});
