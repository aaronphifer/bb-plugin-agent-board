import { describe, it, expect } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { CURRENT_RELEASE } from "../lib/releases";
import type { GlobalDashboardSnapshot } from "../contract/rpc";
describe("Phase 1 server contracts", () => {
  it("persists a schema-validated release dismissal across plugin reload", async () => {
    const host = createFakePluginHost({ pluginId: "agent-board" }); await plugin(host.bb);
    const before = await host.harness.behavior.callRpc("release_announcement", {});
    expect(before).toMatchObject({ version: CURRENT_RELEASE.version, dismissed: false });
    await host.harness.behavior.callRpc("dismiss_release_announcement", { version: CURRENT_RELEASE.version });
    const next = await host.harness.lifecycle.reload(plugin);
    expect(await next.harness.behavior.callRpc("release_announcement", {})).toMatchObject({ dismissed: true, version: CURRENT_RELEASE.version }); await next.harness.lifecycle.dispose();
  });
  it("survives failed watcher attachment and exposes unavailable health", async () => {
    const host = createFakePluginHost({ pluginId: "agent-board", sdk: { subscribe: () => { throw new Error("Synthetic subscription failure"); } } });
    await plugin(host.bb); const dashboard = await host.harness.behavior.callRpc("global_dashboard", {}) as GlobalDashboardSnapshot;
    expect(dashboard.monitoring?.status).toBe("unavailable"); expect(JSON.stringify(dashboard.monitoring)).not.toContain("Synthetic"); await host.harness.lifecycle.dispose();
  });
});
