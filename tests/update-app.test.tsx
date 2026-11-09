// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type { UpdateAvailable as UpdateComponent } from "../components/global/update-available";

let app: CapturedPluginApp;
let UpdateAvailable: typeof UpdateComponent;
beforeEach(async () => { window.localStorage.clear(); app = await loadPluginApp(() => import("../app")); UpdateAvailable = (await import("../components/global/update-available")).UpdateAvailable; });
afterEach(cleanup);
const state = { installed: "0.7.0", latest: "0.8.0", releaseUrl: "https://github.com/aaronphifer/bb-plugin-agent-board/releases/tag/v0.8.0", eligible: { version: "sha-08", display: "Agent Board v0.8.0" }, discoveryUnavailable: false };
function mount(eligible = true) {
  const install = vi.fn(async () => ({ applied: true, outcome: "updated", detail: null }));
  const slot = renderSlot({ component: UpdateAvailable }, {}, { rpc: { release_update: () => ({ ...state, eligible: eligible ? state.eligible : null }), install_update: install } });
  return { slot, install };
}
describe("update card", () => {
  it("checks without installing and requires explicit confirmation", async () => {
    const { slot, install } = mount();
    fireEvent.click(await slot.findByRole("button", { name: "Review update" }));
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Review update" }));
    fireEvent.click(slot.getByRole("button", { name: "Install update" }));
    await slot.findByText(/Update installed/);
    expect(install).toHaveBeenCalledWith({ expectedVersion: "sha-08" });
  });
  it("keeps out-of-range upgrades read-only and links directly to release notes", async () => {
    const { slot, install } = mount(false);
    fireEvent.click(await slot.findByRole("button", { name: "Release notes" }));
    expect(slot.queryByRole("button", { name: "Review update" })).toBeNull();
    expect(install).not.toHaveBeenCalled();
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "openUrl", url: state.releaseUrl });
  });
  it("keeps the dismissal for that release across remounts", async () => {
    const first = mount();
    fireEvent.click(await first.slot.findByRole("button", { name: "Dismiss update notice" }));
    first.slot.unmount();
    const second = mount();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(second.slot.queryByRole("region", { name: "Agent Board update available" })).toBeNull();
  });
});
