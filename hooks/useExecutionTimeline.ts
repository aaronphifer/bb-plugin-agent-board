// Lazy execution-timeline data hook. It performs no RPC until the shared
// Timeline dialog opens, then follows existing Agent Board invalidations only
// while the selected execution remains active. There is no timer or poll.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import {
  BOARD_CHANGED_CHANNEL,
  type ExecutionTimeline,
  type ExecutionTimelineInput,
  type rpcContract,
} from "@/contract/rpc";

export interface ExecutionTimelineState {
  timeline: ExecutionTimeline | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

export function useExecutionTimeline(
  input: ExecutionTimelineInput,
  open: boolean,
): ExecutionTimelineState {
  const rpc = useRpc<typeof rpcContract>();
  const [timeline, setTimeline] = useState<ExecutionTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openRef = useRef(open);
  const timelineRef = useRef<ExecutionTimeline | null>(null);
  const inflight = useRef(false);
  const pendingSignal = useRef(false);
  const requestId = useRef(0);
  const loadRef = useRef<() => void>(() => {});
  const targetKey = input.source === "bb"
    ? `bb:${input.executionKey}:${input.threadId}`
    : input.source === "ollama-fleet" ? `ollama-fleet:${input.executionKey}:${input.jobId}` : `redteam:${input.executionKey}:${input.scanId}`;

  openRef.current = open;
  timelineRef.current = timeline;

  const load = useCallback(() => {
    if (!openRef.current) return;
    if (inflight.current) {
      pendingSignal.current = true;
      return;
    }
    inflight.current = true;
    const id = ++requestId.current;
    if (timelineRef.current === null) setLoading(true);
    else setRefreshing(true);
    const rpcInput: ExecutionTimelineInput = input.source === "bb"
      ? { source: "bb", executionKey: input.executionKey, threadId: input.threadId }
      : input.source === "ollama-fleet" ? { source: "ollama-fleet", executionKey: input.executionKey, jobId: input.jobId } : { source: "redteam", executionKey: input.executionKey, scanId: input.scanId };
    rpc.call("execution_timeline", rpcInput).then(
      (result) => {
        if (id !== requestId.current) return;
        timelineRef.current = result;
        setTimeline(result);
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
      const shouldFollow = pendingSignal.current && (timelineRef.current?.active ?? true);
      pendingSignal.current = false;
      if (shouldFollow && openRef.current) queueMicrotask(() => loadRef.current());
    });
  }, [input, rpc]);
  loadRef.current = load;

  // Target changes discard the old view. Opening is the sole initial-fetch
  // gate, so global/scoped summary renders add zero timeline requests.
  useEffect(() => {
    requestId.current += 1;
    inflight.current = false;
    pendingSignal.current = false;
    timelineRef.current = null;
    setTimeline(null);
    setError(null);
    setLoading(false);
    setRefreshing(false);
    if (open) queueMicrotask(() => loadRef.current());
  }, [open, targetKey]);

  useRealtime(BOARD_CHANGED_CHANNEL, () => {
    if (openRef.current && (timelineRef.current?.active ?? true)) loadRef.current();
  });

  // Reconcile once after a reconnect if this active timeline was open.
  const connectionState = useRealtimeConnectionState();
  const everConnected = useRef(false);
  const previousConnection = useRef(connectionState);
  useEffect(() => {
    const previous = previousConnection.current;
    previousConnection.current = connectionState;
    if (
      connectionState === "connected" &&
      previous !== "connected" &&
      everConnected.current &&
      openRef.current &&
      (timelineRef.current?.active ?? true)
    ) {
      loadRef.current();
    }
    if (connectionState === "connected") everConnected.current = true;
  }, [connectionState]);

  return { timeline, loading, refreshing, error, refetch: load };
}
