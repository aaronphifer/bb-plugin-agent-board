// bb-plugin-agent-board — the multi-agent Kanban board (existing view).
//
// Extracted unchanged from board.tsx when the single-agent focus mode was
// added: whenever the board is watching more than one logical execution
// (or no execution at all), this is the view the user gets.
import { useMemo } from "react";
import type { BoardCard, BoardColumn, BoardSnapshot } from "@/contract/rpc";
import { BoardCardView } from "@/components/board/board-card-view";
import { usePrefersReducedMotion } from "@/components/ui/hooks/use-media-query";

const COLUMNS: ReadonlyArray<{ id: BoardColumn; title: string; hint: string }> = [
  { id: "plan", title: "PLAN / QUEUED", hint: "Not started, queued, or waiting" },
  { id: "active", title: "ACTIVE AGENTS", hint: "Running right now" },
  { id: "output", title: "OUTPUTS / DONE", hint: "Finished, failed, interrupted" },
];

export function KanbanBoard({ snapshot, now }: { snapshot: BoardSnapshot; now: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const byColumn = useMemo(() => {
    const map = new Map<BoardColumn, BoardCard[]>([
      ["plan", []],
      ["active", []],
      ["output", []],
    ]);
    for (const card of snapshot.cards) {
      map.get(card.column)?.push(card);
    }
    return map;
  }, [snapshot]);

  return (
    <div
      data-testid="kanban-board"
      data-motion={reducedMotion ? "reduced" : "full"}
      className="grid gap-3 md:grid-cols-3"
    >
      {COLUMNS.map((column) => {
        const cards = byColumn.get(column.id) ?? [];
        return (
          <section key={column.id} aria-label={column.title} className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between px-0.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {column.title}
              </h3>
              <span className="text-[11px] tabular-nums text-muted-foreground/70" title={column.hint}>
                {cards.length}
              </span>
            </div>
            {cards.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground/60">
                {column.id === "active" ? "Nothing running" : "Empty"}
              </div>
            ) : (
              <div className="space-y-2">
                {cards.map((card) => (
                  <BoardCardView
                    key={card.key}
                    card={card}
                    now={now}
                    liveTreatment
                    reducedMotion={reducedMotion}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
