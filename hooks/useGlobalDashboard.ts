// Global dashboard data hook. Core thread events drive immediate refreshes;
// one slow bounded discovery check catches unrelated optional-plugin work.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import {
  BOARD_CHANGED_CHANNEL,
  boardChangedPayloadSchema,
  type AttentionItem,
  type GlobalDashboardSnapshot,
  type rpcContract,
} from "@/contract/rpc";

export const GLOBAL_DISCOVERY_INTERVAL_MS = 20_000;

export function isForGlobalDashboard(payload: unknown): boolean {
  const parsed = boardChangedPayloadSchema.safeParse(payload);
  if (!parsed.success) return true;
  return parsed.data.global === true || parsed.data.roots.length === 0;
}

export function useGlobalDashboard() {
  const rpc = useRpc<typeof rpcContract>();
  const [snapshot, setSnapshot] = useState<GlobalDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const snapshotRef = useRef<GlobalDashboardSnapshot | null>(null);
  const inflight = useRef(false);
  /**
   * A refetch signal arrived while a fetch was in flight. The signal is not
   * dropped (the old bug: a terminal-state signal lost this way never
   * returned, leaving the dashboard showing RUNNING forever) — instead one
   * trailing refetch runs when the in-flight request settles. Bounded: the
   * flag collapses any signal burst into a single retry, and the retry only
   * runs when a signal actually arrived, so it can never loop or storm.
   */
  const pendingSignal = useRef(false);
  const requestId = useRef(0);

  const refetch = useCallback((options?: { fresh?: boolean }) => {
    if (inflight.current) {
      pendingSignal.current = true;
      return;
    }
    inflight.current = true;
    const id = ++requestId.current;
    if (snapshotRef.current === null) setLoading(true);
    else setRefreshing(true);
    rpc.call("global_dashboard", { fresh: options?.fresh === true }).then(
      (result) => {
        if (id !== requestId.current) return;
        snapshotRef.current = result;
        setSnapshot(result);
        setError(null);
      },
      (cause: unknown) => {
        if (id !== requestId.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    ).finally(() => {
      if (id !== requestId.current) return;
      inflight.current = false;
      setLoading(false);
      setRefreshing(false);
      if (pendingSignal.current) {
        pendingSignal.current = false;
        refetch(options);
      }
    });
  }, [rpc]);

  useEffect(() => {
    refetch();
    return () => {
      requestId.current += 1;
      inflight.current = false;
    };
  }, [refetch]);

  useRealtime(BOARD_CHANGED_CHANNEL, (payload) => {
    if (isForGlobalDashboard(payload)) refetch();
  });

  const connectionState = useRealtimeConnectionState();
  const everConnected = useRef(false);
  const previousConnection = useRef(connectionState);
  useEffect(() => {
    const was = previousConnection.current;
    previousConnection.current = connectionState;
    if (connectionState === "connected" && was !== "connected" && everConnected.current) refetch();
    if (connectionState === "connected") everConnected.current = true;
  }, [connectionState, refetch]);

  /** Presentation-only: hide one attention item (persists via plugin storage). */
  const dismissAttention = useCallback(
    async (item: AttentionItem) => {
      try {
        await rpc.call("dismiss_attention", {
          executionKey: item.executionKey,
          type: item.type,
          updatedAt: item.updatedAt,
        });
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
      refetch();
    },
    [rpc, refetch],
  );

  /** Presentation-only: forget every stored attention dismissal. */
  const clearDismissedAttentions = useCallback(async () => {
    try {
      await rpc.call("clear_dismissed_attentions", {});
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    refetch();
  }, [rpc, refetch]);

  // BB lifecycle events are immediate. This slow mounted-page check exists
  // only to discover a new Redteam run, whose realtime channel cannot be
  // subscribed to cross-plugin on runtime SDK 0.4.21.
  useEffect(() => {
    const timer = setInterval(() => refetch(), GLOBAL_DISCOVERY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refetch]);

  const hasLive = useMemo(
    () => snapshot?.active.some((execution) =>
      execution.card.status === "running" ||
      execution.card.status === "starting" ||
      execution.card.status === "waiting",
    ) ?? false,
    [snapshot],
  );
  useEffect(() => {
    if (!hasLive) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [hasLive]);

  return {
    snapshot,
    loading,
    refreshing,
    error,
    tick,
    refetch,
    dismissAttention,
    clearDismissedAttentions,
    connectionState,
  };
}
