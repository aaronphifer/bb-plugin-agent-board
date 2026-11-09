import { z } from "zod";
import type { GlobalExecution } from "../contract/rpc";
import { EMPTY_FILTERS } from "./dashboard-view";

export const PREFERENCES_KEY = "agent-board:dashboard:v1";
const filtersSchema = z.object({ project: z.string().max(500), repository: z.string().max(500), workspace: z.string().max(500).default(""), provider: z.string().max(500), status: z.string().max(500) });
const viewSchema = z.object({ filters: filtersSchema, grouping: z.enum(["none", "project", "repository", "workspace", "provider", "status"]), window: z.enum(["all", "day", "week"]) });
const preferencesSchema = viewSchema.extend({ saved: z.array(viewSchema.extend({ name: z.string().trim().min(1).max(60) })).max(8) });
export type DashboardPreferences = z.infer<typeof preferencesSchema>;
export const DEFAULT_PREFERENCES: DashboardPreferences = { filters: EMPTY_FILTERS, grouping: "none", window: "all", saved: [] };
export interface BrowserStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function parsePreferences(raw: string | null): DashboardPreferences {
  try { return preferencesSchema.parse(JSON.parse(raw ?? "null")); } catch { return { ...DEFAULT_PREFERENCES, filters: { ...EMPTY_FILTERS }, saved: [] }; }
}
export function readPreferences(storage: BrowserStorage): DashboardPreferences {
  try { return parsePreferences(storage.getItem(PREFERENCES_KEY)); } catch { return parsePreferences(null); }
}
export function writePreferences(value: DashboardPreferences, storage: BrowserStorage): boolean {
  try { storage.setItem(PREFERENCES_KEY, JSON.stringify(preferencesSchema.parse(value))); return true; } catch { return false; }
}
export function saveView(value: DashboardPreferences, name: string): DashboardPreferences {
  const safeName = name.trim().slice(0, 60);
  if (!safeName) return value;
  return { ...value, saved: [...value.saved.filter(v => v.name !== safeName), { name: safeName, filters: { ...value.filters }, grouping: value.grouping, window: value.window }].slice(-8) };
}
export function applyWindow(executions: GlobalExecution[], window: DashboardPreferences["window"], now: number): GlobalExecution[] {
  const age = window === "day" ? 86_400_000 : window === "week" ? 604_800_000 : Infinity;
  return executions.filter(e => ["running", "starting", "waiting", "queued"].includes(e.card.status) || now - (e.card.completedAt ?? e.card.lastActivityAt ?? e.updatedAt) <= age);
}
