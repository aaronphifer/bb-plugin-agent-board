import manifest from "../package.json";

const REPOSITORY = "https://github.com/aaronphifer/bb-plugin-agent-board";
type NativeCheck = { outcome: string; candidate?: { version: string; display: string } };
export interface ReleaseUpdateState {
  installed: string;
  latest: string | null;
  releaseUrl: string | null;
  eligible: { version: string; display: string } | null;
  discoveryUnavailable: boolean;
}
function stableVersion(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80) return null;
  return /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.replace(/^v/, "") : null;
}
export function newerStableVersion(tag: unknown, installed: string): string | null {
  const next = stableVersion(tag), current = stableVersion(installed);
  if (!next || !current) return null;
  const a = next.split(".").map(BigInt), b = current.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) { if (a[i]! > b[i]!) return next; if (a[i]! < b[i]!) return null; }
  return null;
}
/** One public request per hour, coalesced across every mounted client. No install on check. */
export class ReleaseUpdateChecker {
  private cache: { at: number; state: ReleaseUpdateState } | null = null;
  private pending: Promise<ReleaseUpdateState> | null = null;
  private applying = false;
  constructor(private readonly options: {
    installed: string;
    fetchLatest: () => Promise<unknown>;
    checkNative: () => Promise<NativeCheck | undefined>;
    applyNative: () => Promise<{ applied: boolean; outcome: string; detail?: string }>;
    now?: () => number;
  }) {}
  snapshot(): Promise<ReleaseUpdateState> {
    const now = (this.options.now ?? Date.now)();
    if (this.cache && now - this.cache.at < (this.cache.state.discoveryUnavailable ? 900_000 : 3_600_000)) return Promise.resolve(this.cache.state);
    if (this.pending) return this.pending;
    this.pending = this.collect().then(state => { this.cache = { at: now, state }; return state; }).finally(() => { this.pending = null; });
    return this.pending;
  }
  private async collect(): Promise<ReleaseUpdateState> {
    const [release, native] = await Promise.allSettled([this.options.fetchLatest(), this.options.checkNative()]);
    const raw = release.status === "fulfilled" && release.value && typeof release.value === "object" ? release.value as Record<string, unknown> : null;
    const latest = raw && !raw.draft && !raw.prerelease ? newerStableVersion(raw.tag_name, this.options.installed) : null;
    const candidate = native.status === "fulfilled" && native.value?.outcome === "update-available" ? native.value.candidate : null;
    return { installed: this.options.installed, latest,
      releaseUrl: latest ? `${REPOSITORY}/releases/tag/${String(raw!.tag_name)}` : null,
      eligible: candidate ? { version: candidate.version.slice(0, 200), display: candidate.display.slice(0, 240) } : null,
      discoveryUnavailable: release.status === "rejected",
    };
  }
  async install(expectedVersion: string) {
    if (this.applying) throw new Error("An update is already in progress.");
    this.applying = true;
    try {
      const fresh = await this.options.checkNative();
      if (fresh?.outcome !== "update-available" || fresh.candidate?.version !== expectedVersion) throw new Error("The available update changed. Check again before installing.");
      const result = await this.options.applyNative();
      this.cache = null;
      return { applied: result.applied, outcome: result.outcome, detail: result.detail?.slice(0, 320) ?? null };
    } finally { this.applying = false; }
  }
}

/** Fixed official endpoint; no credentials and no user-controlled URLs. */
export async function fetchLatestRelease(): Promise<unknown> {
  const response = await fetch("https://api.github.com/repos/aaronphifer/bb-plugin-agent-board/releases/latest", {
    signal: AbortSignal.timeout(5_000), redirect: "error", headers: { Accept: "application/vnd.github+json", "User-Agent": `bb-agent-board/${manifest.version}` },
  });
  if (!response.ok || !response.body) throw new Error("Release discovery unavailable");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 65_536) throw new Error("Release metadata too large"); chunks.push(chunk.value); }
    const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(all));
  } finally { await reader.cancel().catch(() => {}); }
}
