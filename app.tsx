// bb-plugin-agent-board — a BB plugin frontend entry.
//
// Compiled by `bb plugin build` into dist/app.js + dist/app.css. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time (never bundled).
//
// v1 surface: one thread panel action ("Agent Board") that renders the live
// board for the thread it is opened from. The Board component is
// surface-agnostic: it takes a rootThreadId, so a future entry surface
// (header action, nav panel, message action) can mount it unchanged.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk";
import { Board } from "@/components/board/board";
import { GlobalDashboard } from "@/components/global/global-dashboard";
import "./app.css";

/**
 * The panel host hands us the thread the action was invoked from, plus the
 * persisted `params` (used when another surface opens this panel scoped to a
 * different root: {"rootThreadId": "thr_..."}).
 */
function BoardPanel({ threadId, params }: PluginThreadPanelProps) {
  const fromParams =
    params !== null &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    "rootThreadId" in params &&
    typeof params.rootThreadId === "string"
      ? params.rootThreadId
      : null;
  return <Board rootThreadId={fromParams ?? threadId} />;
}

function GlobalDashboardPage(_props: PluginNavPanelProps) {
  return <GlobalDashboard />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "agent-board-global",
    title: "Agent Board",
    icon: "ListTodo",
    path: "operations",
    component: GlobalDashboardPage,
  });
  app.slots.threadPanelAction({
    id: "agent-board",
    title: "Agent Board",
    icon: "ListTodo",
    layout: "flush",
    component: BoardPanel,
  });
});
