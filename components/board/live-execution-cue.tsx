import { cn } from "@/lib/utils";

export function LiveIndicator({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <span
      data-testid="kanban-live-indicator"
      className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-primary"
      aria-label="Live execution"
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full bg-primary", !reducedMotion && "ab-live-dot")}
        aria-hidden="true"
      />
      Live
    </span>
  );
}

export function LiveStrip({ identity, reducedMotion }: { identity: string; reducedMotion: boolean }) {
  const variant = [...identity].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
  return (
    <div
      data-testid="kanban-live-strip"
      data-motion-variant={variant}
      className={cn("ab-strip", reducedMotion && "ab-strip-static")}
      role="presentation"
    />
  );
}
