// The Agent Board thread action tab's component, typed with the props the
// host passes a thread action tab.
import type { ComponentType } from "react";
import type { ExperimentalThreadActionTabProps } from "@get-bb/plugin-sdk";

export function boardTabComponent(app: {
  tabs: ReadonlyArray<{ id: string; component: unknown }>;
}): ComponentType<ExperimentalThreadActionTabProps> {
  const tab = app.tabs.find((candidate) => candidate.id === "agent-board");
  if (!tab) throw new Error("Agent Board tab is not registered");
  return tab.component as ComponentType<ExperimentalThreadActionTabProps>;
}
