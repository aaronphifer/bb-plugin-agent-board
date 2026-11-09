import { z } from "zod";

export interface TimelinePosition { timestamp: number; sequence: number; id: string }
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cursorSchema = z.object({
  version: z.literal(1), executionKey: z.string().min(1).max(240), threadId: z.string().min(1).max(240),
  anchor: z.object({ anchorId: z.string().min(1).max(500), anchorSeq: integer }).nullable(),
  before: z.object({ timestamp: integer, sequence: integer, id: z.string().min(1).max(320) }).nullable(),
  lifecycleBeforeSeq: integer.nullable(),
  rowsDone: z.boolean(), lifecycleDone: z.boolean(),
  retryLifecycle: z.boolean().default(false),
}).strict();
export type TimelineCursor = z.infer<typeof cursorSchema>;
export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursorSchema.parse(cursor))).toString("base64url");
}
export function decodeTimelineCursor(value: string | undefined, executionKey: string, threadId: string): TimelineCursor | null {
  if (!value) return null;
  try {
    if (value.length > 4096) throw new Error();
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (cursor.executionKey !== executionKey || cursor.threadId !== threadId) throw new Error();
    return cursor;
  } catch { throw new Error("Timeline history cursor is invalid. Close and reopen the timeline."); }
}
export function compareTimelinePosition(a: TimelinePosition, b: TimelinePosition): number {
  return a.timestamp - b.timestamp || a.sequence - b.sequence || a.id.localeCompare(b.id);
}
