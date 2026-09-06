// bb-plugin-agent-board — the board data hook.
//
// One bounded fetch per invalidation signal: the backend publishes
// "agent-board-changed" and this hook refetches board_snapshot. No polling.
// A 1s local ticker drives live elapsed timers between snapshots.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import {
  BOARD_CHANGED_CHANNEL,
  boardChangedPayloadSchema,
  type BoardSnapshot,
  type rpcContract,
} from "@/contract/rpc";

interface BoardState {
  snapshot: BoardSnapshot | null;
  /** Set after the first fetch for a threadId resolves or rejects. */
  loading: boolean;
  /** Fetch in flight after the first (manual refresh / signal refetch). */
  refreshing: boolean;
  error: string | null;
  /** Advances every second while any card is still live (running/waiting). */
  tick: number;
  refetch: (options?: { fresh?: boolean }) => void;
}

/**
 * Parse a realtime payload defensively: only the `roots` array is trusted,
 * and anything malformed means "refetch" (the safe default).
 */
export function isForThisBoard(payload: unknown, rootThreadId: string): boolean {
  const parsed = boardChangedPayloadSchema.safeParse(payload);
  if (!parsed.success) return true; // unreadable signal: assume relevant
  const roots = parsed.data.roots;
  if (roots.length === 0) return parsed.data.global !== true;
  return roots.includes(rootThreadId);
}

export function useBoard(rootThreadId: string): BoardState {
  const rpc = useRpc<typeof rpcContract>();
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const requestId = useRef(0);

  const refetch = useCallback(
    (options?: { fresh?: boolean }) => {
      const id = ++requestId.current;
      if (snapshot === null) setLoading(true);
      else setRefreshing(true);
      rpc
        .call("board_snapshot", {
          threadId: rootThreadId,
          fresh: options?.fresh === true,
        })
        .then(
          (result) => {
            if (id !== requestId.current) return; // a newer fetch superseded this one
            setSnapshot(result);
            setError(null);
          },
          (cause: unknown) => {
            if (id !== requestId.current) return;
            setError(cause instanceof Error ? cause.message : String(cause));
          },
        )
        .finally(() => {
          if (id !== requestId.current) return;
          setLoading(false);
          setRefreshing(false);
        });
    },
    [rpc, rootThreadId, snapshot],
  );

  // Initial fetch when the board opens (and on thread change).
  useEffect(() => {
    requestId.current++;
    setSnapshot(null);
    setError(null);
    setLoading(true);
    rpc
      .call("board_snapshot", { threadId: rootThreadId })
      .then(
        (result) => {
          setSnapshot(result);
          setError(null);
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      )
      .finally(() => {
        setLoading(false);
      });
  }, [rpc, rootThreadId]);

  // Backend invalidation → refetch (bounded: debounced server-side, cached
  // server-side, race-guarded here).
  useRealtime(BOARD_CHANGED_CHANNEL, (payload) => {
    if (isForThisBoard(payload, rootThreadId)) refetch();
  });

  // After a realtime reconnect, reconcile: signals emitted while offline
  // were missed, so refetch once (but not on the first connect — the mount
  // effect already fetched).
  const connectionState = useRealtimeConnectionState();
  const everConnected = useRef(false);
  const prevState = useRef(connectionState);
  useEffect(() => {
    const was = prevState.current;
    prevState.current = connectionState;
    if (connectionState === "connected" && was !== "connected" && everConnected.current) {
      refetch();
    }
    if (connectionState === "connected") everConnected.current = true;
  }, [connectionState, refetch]);

  // Local timer: only while work is live, so idle boards cost nothing.
  const hasLive = useMemo(
    () =>
      snapshot !== null &&
      (snapshot.counts.running > 0 ||
        snapshot.counts.waiting > 0 ||
        snapshot.counts.queued > 0),
    [snapshot],
  );
  useEffect(() => {
    if (!hasLive) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [hasLive]);

  return { snapshot, loading, refreshing, error, tick, refetch };
}
