import { useEffect, useRef, useState } from "react";
import type { GlobalDashboardSnapshot } from "@/contract/rpc";
import { CATCH_UP_KEY, catchUpChanges, mergeCheckpoint, parseCheckpoint, type Checkpoint } from "@/lib/catch-up";

export function useCatchUp(snapshot: GlobalDashboardSnapshot | null) {
  const [baseline, setBaseline] = useState<Checkpoint | null>(() => { try { return parseCheckpoint(window.localStorage.getItem(CATCH_UP_KEY)); } catch { return null; } });
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const baselineRef = useRef(baseline); baselineRef.current = baseline;
  function persist(value: Checkpoint) { try { window.localStorage.setItem(CATCH_UP_KEY, JSON.stringify(value)); } catch { /* Usable for this visit even without persistence. */ } }
  useEffect(() => {
    if (!snapshot || baseline !== null || snapshot.unavailableSources.includes("bb")) return;
    const initial = mergeCheckpoint(null, snapshot); persist(initial); setBaseline(initial);
  }, [snapshot, baseline]);
  useEffect(() => () => {
    if (latest.current && !latest.current.unavailableSources.includes("bb")) persist(mergeCheckpoint(baselineRef.current, latest.current));
  }, []);
  return { changes: snapshot ? catchUpChanges(snapshot, baseline) : [], since: baseline?.at ?? null,
    markSeen() { if (snapshot && !snapshot.unavailableSources.includes("bb")) { const next = mergeCheckpoint(baseline, snapshot); persist(next); setBaseline(next); } },
  };
}
