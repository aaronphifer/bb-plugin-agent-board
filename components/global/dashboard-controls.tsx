import { useState } from "react";
import type { GlobalExecution } from "@/contract/rpc";
import { EMPTY_FILTERS, filterOptions, type FilterField } from "@/lib/dashboard-view";
import { saveView, type DashboardPreferences } from "@/lib/dashboard-preferences";
import { Button } from "@/components/ui/button";

export function DashboardControls({ executions, value, onChange }: { executions: GlobalExecution[]; value: DashboardPreferences; onChange: (value: DashboardPreferences) => void }) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const filtered = Object.values(value.filters).some(Boolean) || value.window !== "all";
  return <details className="mt-3 min-w-0 rounded-lg border border-border/70 p-2" data-part="dashboard-controls">
    <summary className="cursor-pointer text-xs text-muted-foreground">Views and filters{filtered ? " · Filters applied" : ""}</summary>
    <section aria-label="Session filters" className="mt-3 space-y-2">
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(["project", "repository", "workspace", "provider", "status"] as FilterField[]).map(field => {
          const options = filterOptions(executions, field);
          const current = value.filters[field];
          return <label key={field} className="min-w-0 text-xs capitalize">{field}<select aria-label={`Filter by ${field}`} className="mt-1 block w-full min-w-0 rounded border border-border bg-background p-1.5 text-xs" value={current} onChange={event => onChange({ ...value, filters: { ...value.filters, [field]: event.target.value } })}>
            <option value="">All {field === "repository" ? "repositories" : field === "status" ? "statuses" : `${field}s`}</option>
            {current && !options.some(o => o.value === current) ? <option value={current}>{current.replace(/^value:/, "")} (outside snapshot)</option> : null}
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>;
        })}
        <label className="text-xs">Group by<select aria-label="Group sessions by" value={value.grouping} onChange={e => onChange({ ...value, grouping: e.target.value as DashboardPreferences["grouping"] })} className="mt-1 block w-full rounded border border-border bg-background p-1.5 text-xs">{["none", "project", "repository", "workspace", "provider", "status"].map(group => <option key={group} value={group}>{group === "none" ? "None" : group}</option>)}</select></label>
        <label className="text-xs">Recent history<select aria-label="Recent history" value={value.window} onChange={e => onChange({ ...value, window: e.target.value as DashboardPreferences["window"] })} className="mt-1 block w-full rounded border border-border bg-background p-1.5 text-xs"><option value="all">Available snapshot</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option></select></label>
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs">Saved views<select aria-label="Saved views" value={selected} onChange={e => { const saved = value.saved.find(v => v.name === e.target.value); setSelected(e.target.value); if (saved) onChange({ ...value, filters: { ...saved.filters }, grouping: saved.grouping, window: saved.window }); }} className="mt-1 block w-full rounded border border-border bg-background p-1.5 text-xs"><option value="">Choose a view</option>{value.saved.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</select></label>
        {selected ? <Button size="sm" variant="ghost" onClick={() => { onChange({ ...value, saved: value.saved.filter(v => v.name !== selected) }); setSelected(""); }}>Delete view</Button> : null}
        <label className="min-w-0 flex-1 text-xs">View name<input aria-label="Saved view name" maxLength={60} value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded border border-border bg-background p-1.5 text-xs" /></label>
        <Button size="sm" variant="outline" disabled={!name.trim()} onClick={() => { onChange(saveView(value, name)); setSelected(name.trim()); setName(""); }}>Save view</Button>
        {filtered ? <Button size="sm" variant="ghost" onClick={() => { onChange({ ...value, filters: { ...EMPTY_FILTERS }, window: "all" }); setSelected(""); }}>Reset filters</Button> : null}
      </div>
      <p className="text-[11px] text-muted-foreground">Filters narrow the available snapshot, not all historical work. Needs attention covers all observed work. Views are saved in this browser.</p>
    </section>
  </details>;
}
