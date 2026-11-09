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
import { mergeTimelineEvents } from "@/lib/timeline-view";

export interface ExecutionTimelineState {
  timeline: ExecutionTimeline | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
  loadingEarlier: boolean;
  earlierError: string | null;
  loadEarlier: () => void;
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
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);
  const olderInflight = useRef(false);
  const generation = useRef(0);
  const bridges = useRef<{ resumeCursor: string | null; knownIds: Set<string> }[]>([]);
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
    if (olderInflight.current) { pendingSignal.current = true; return; }
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
        const current = timelineRef.current;
        const overlaps = current?.events.some(event => result.events.some(next => next.id === event.id)) ?? false;
        const needsBridge = !!current?.events.length && !overlaps && !!result.olderCursor;
        if (needsBridge) bridges.current.push({ resumeCursor: current?.olderCursor ?? null, knownIds: new Set(current!.events.slice(-80).map(event => event.id)) });
        const combined = current ? { ...result, events: mergeTimelineEvents(current.events, result.events),
          olderCursor: needsBridge ? result.olderCursor : current.olderCursor ?? (overlaps ? null : result.olderCursor),
          truncated: current.olderCursor || overlaps ? current.truncated : result.truncated } : result;
        timelineRef.current = combined;
        setTimeline(combined);
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

  const loadEarlier = useCallback(() => {
    const cursor = timelineRef.current?.olderCursor;
    if (!openRef.current || input.source !== "bb" || !cursor || olderInflight.current || inflight.current) return;
    const currentGeneration = generation.current;
    olderInflight.current = true; setLoadingEarlier(true); setEarlierError(null);
    rpc.call("execution_timeline", { source: "bb", executionKey: input.executionKey, threadId: input.threadId, cursor }).then(result => {
      if (generation.current !== currentGeneration || !openRef.current || !timelineRef.current) return;
      const current = timelineRef.current;
      const bridge = bridges.current.at(-1);
      const reachedKnownHistory = bridge && (result.events.some(event => bridge.knownIds.has(event.id)) || !result.olderCursor);
      const nextCursor = reachedKnownHistory ? bridges.current.pop()!.resumeCursor : result.olderCursor;
      const combined = { ...current, events: mergeTimelineEvents(current.events, result.events), olderCursor: nextCursor, truncated: !!nextCursor || result.truncated,
        sourceWarning: result.sourceWarning ?? current.sourceWarning };
      timelineRef.current = combined; setTimeline(combined);
    }, (cause: unknown) => {
      if (generation.current === currentGeneration && openRef.current) setEarlierError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (generation.current !== currentGeneration) return;
      olderInflight.current = false; setLoadingEarlier(false);
      if (pendingSignal.current && openRef.current && timelineRef.current?.active) { pendingSignal.current = false; queueMicrotask(() => loadRef.current()); }
    });
  }, [input, rpc]);

  // Target changes discard the old view. Opening is the sole initial-fetch
  // gate, so global/scoped summary renders add zero timeline requests.
  useEffect(() => {
    generation.current += 1;
    requestId.current += 1;
    inflight.current = false;
    pendingSignal.current = false;
    timelineRef.current = null;
    setTimeline(null);
    setError(null);
    setLoading(false);
    setRefreshing(false);
    olderInflight.current = false; setLoadingEarlier(false); setEarlierError(null);
    bridges.current = [];
    if (open) queueMicrotask(() => loadRef.current());
    return () => { generation.current += 1; requestId.current += 1; };
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

  return { timeline, loading, refreshing, error, refetch: load, loadingEarlier, earlierError, loadEarlier };
}
