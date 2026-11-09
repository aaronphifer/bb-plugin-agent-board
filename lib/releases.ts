import manifest from "../package.json";
import type { KvLike } from "./dismissals";

export const CURRENT_RELEASE = {
  version: manifest.version,
  title: "Catch up, take action, and browse earlier activity",
  highlights: [
    "Reply to questions, review approvals, and inspect failures from Needs Attention.",
    "Catch up on changes, save dashboard views, and review completed work.",
    "Load earlier BB timeline activity without losing your place.",
    "See available releases and review compatible updates before installing.",
  ],
};
const STORAGE_KEY = "release-dismissals";
export class ReleaseAnnouncementStore {
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private readonly kv: KvLike, private readonly release = CURRENT_RELEASE) {}
  private async versions(): Promise<string[]> {
    const value = await this.kv.get<unknown>(STORAGE_KEY);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length <= 80).slice(-20) : [];
  }
  async snapshot() {
    await this.writing.catch(() => {});
    return { ...this.release, dismissed: (await this.versions()).includes(this.release.version) };
  }
  async dismiss(version: string) {
    if (version !== this.release.version) throw new Error("Plugin version changed. Reopen release notes and try again.");
    const write = this.writing.catch(() => {}).then(async () => {
      const versions = await this.versions();
      await this.kv.set(STORAGE_KEY, [...versions.filter(v => v !== version), version].slice(-20));
      return { dismissed: true };
    });
    this.writing = write;
    return write;
  }
}
