// Global dashboard data hook. The page reads global_dashboard through BB's
// shared RPC query cache; the backend invalidates its tag on BB changes and,
// while the page is watched, every 20 seconds to discover new optional-plugin
// work. The host refetches on invalidation and after reconnects.
import { useCallback, useEffect, useState } from "react";
import { experimental_useRpcQuery, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import {
  BOARD_CHANGED_CHANNEL,
  boardChangedPayloadSchema,
  rpcContract,
  type AttentionItem,
} from "@/contract/rpc";

export function isForGlobalDashboard(payload: unknown): boolean {
  const parsed = boardChangedPayloadSchema.safeParse(payload);
  if (!parsed.success) return true;
  return parsed.data.global === true || parsed.data.roots.length === 0;
}

export function useGlobalDashboard() {
  const rpc = useRpc<typeof rpcContract>();
  const query = experimental_useRpcQuery({
    contract: rpcContract,
    method: "global_dashboard",
    input: {},
  });
  const snapshot = query.data ?? null;
  const [freshPending, setFreshPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [lastSignalAt, setLastSignalAt] = useState<number | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const refetchQuery = query.refetch;
  const fetchedAt = snapshot?.fetchedAt;

  useEffect(() => {
    if (fetchedAt === undefined) return;
    setLastRefreshAt(Date.now());
    setActionError(null);
  }, [fetchedAt]);

  const refetch = useCallback((options?: { fresh?: boolean }) => {
    if (options?.fresh !== true) {
      void refetchQuery();
      return;
    }
    setFreshPending(true);
    void rpc
      .call("global_dashboard", { fresh: true })
      .catch(() => undefined)
      .then(() => refetchQuery())
      .finally(() => setFreshPending(false));
  }, [rpc, refetchQuery]);

  useRealtime(BOARD_CHANGED_CHANNEL, (payload) => {
    if (isForGlobalDashboard(payload)) setLastSignalAt(Date.now());
  });

  const connectionState = useRealtimeConnectionState();

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
        setActionError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [rpc],
  );

  /** Presentation-only: forget every stored attention dismissal. */
  const clearDismissedAttentions = useCallback(async () => {
    try {
      await rpc.call("clear_dismissed_attentions", {});
    } catch (cause: unknown) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  return {
    snapshot,
    loading: query.isLoading,
    refreshing: freshPending || (query.isFetching && snapshot !== null),
    error: actionError ?? query.error?.message ?? null,
    tick,
    refetch,
    dismissAttention,
    clearDismissedAttentions,
    connectionState,
    lastSignalAt,
    lastRefreshAt,
  };
}
