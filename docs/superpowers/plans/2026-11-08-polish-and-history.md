# Subtle polish and navigable timeline history

Aaron approved the style preview and requested access to earlier timeline history in thread thr_5nkjvuqs3j.

## Scope and design

- Match the approved preview: restrained semantic edges, stronger operation text, elapsed time by the title, compact expandable recent results, a more prominent Reply action, and the existing indeterminate running strip.
- Confirmed reproduction: the installed run timeline returns 50 events, truncated=true, and no continuation. The dialog has only a max-height with a flexible child in a grid, allowing content clipping.
- BB history will use the public beforeAnchorId/beforeAnchorSeq cursor. Normalized events also need a position within each source page, otherwise the 50/80-event cap loses events before the BB page cursor is advanced.
- Each response stays bounded to 80 events. A validated cursor tracks the source page, event position, and lifecycle page. Loading older pages merges by stable event ID without replacing loaded history. Pages refresh independently; older load failures retain all visible history and allow retry.
- Give the dialog a constrained flex column and preserve the top visible event while prepending. Live following only applies when the user remains at the newest events.
- Redteam/Fleet expose retained bounded snapshots rather than a historical cursor; label those limits accurately rather than promising unavailable history.

## Work

- [x] Add failing normalization, collector, and UI regressions covering events omitted within one source page, BB cursor boundaries, equal timestamps, target changes, retries and scroll anchoring.
- [x] Implement validated pagination and lazy load-earlier behavior; preserve loaded history during active refreshes.
- [x] Apply the approved visual polish without changing activity-strip semantics.
- [x] Run full tests, typecheck, build and package checks; verify real desktop/mobile scrolling and loading older history. Commit and reload the authorized local test installation.

No public release, tag, source-range change or marketplace publication.

## Verification

- 505 tests passed; TypeScript and BB frontend/backend build passed.
- Package check passed.
- Six real history pages returned 300 distinct events with an earlier cursor still available.
- Review found and regressions fixed disjoint refresh gaps and lifecycle retry loss.
- Desktop/mobile scroll and anchor verification are recorded in thread storage; the existing local test install is reloaded for Aaron.
