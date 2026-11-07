// bb-plugin-agent-board — the board data hook.
//
// The board reads board_snapshot through BB's shared RPC query cache. The
// backend invalidates the board's tag when a watched thread changes, and the
// host refetches on invalidation and after reconnects. No polling. Holding
// the read is also what keeps the backend's watcher and pollers running for
// this root. A 1s local ticker drives live elapsed timers between snapshots.
import { useCallback, useEffect, useMemo, useState } from "react";
import { experimental_useRpcQuery, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, type BoardSnapshot } from "@/contract/rpc";

interface BoardState {
  snapshot: BoardSnapshot | null;
  /** True until the first fetch for a threadId resolves or rejects. */
  loading: boolean;
  /** Fetch in flight after the first (manual refresh / invalidation refetch). */
  refreshing: boolean;
  error: string | null;
  /** Advances every second while any card is still live (running/waiting). */
  tick: number;
  refetch: (options?: { fresh?: boolean }) => void;
}

export function useBoard(rootThreadId: string): BoardState {
  const rpc = useRpc<typeof rpcContract>();
  const query = experimental_useRpcQuery({
    contract: rpcContract,
    method: "board_snapshot",
    input: { threadId: rootThreadId },
  });
  const snapshot = query.data ?? null;
  const [freshPending, setFreshPending] = useState(false);
  const [tick, setTick] = useState(0);
  const refetchQuery = query.refetch;

  // `fresh` bypasses the backend's short-lived caches; the follow-up read
  // then serves that fresh snapshot to every view of this board.
  const refetch = useCallback(
    (options?: { fresh?: boolean }) => {
      if (options?.fresh !== true) {
        void refetchQuery();
        return;
      }
      setFreshPending(true);
      void rpc
        .call("board_snapshot", { threadId: rootThreadId, fresh: true })
        .catch(() => undefined)
        .then(() => refetchQuery())
        .finally(() => setFreshPending(false));
    },
    [rpc, rootThreadId, refetchQuery],
  );

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

  return {
    snapshot,
    loading: query.isLoading,
    refreshing: freshPending || (query.isFetching && snapshot !== null),
    error: query.error?.message ?? null,
    tick,
    refetch,
  };
}
