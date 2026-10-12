import manifest from "../package.json";
import type { KvLike } from "./dismissals";

export const CURRENT_RELEASE = {
  version: manifest.version,
  title: "A clearer view of agent activity",
  highlights: [
    "See recent or quiet reporting without treating long tasks as stalled.",
    "Filter and group visible work by project, repository, provider and status.",
    "Review completion results, failures and agent-reported verification.",
    "Check connection, refresh and watcher health; empty attention stays compact.",
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
