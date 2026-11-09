# Agent Board daily workflow

Aaron approved the five-item priority list in BB thread thr_5nkjvuqs3j for implementation. Build on the existing TypeScript/React plugin, retaining its bounded, read-only observation model and current supported SDK floor.

## Approach

Extend the existing normalized cards, collector, and global dashboard. Reuse BB thread navigation and the existing execution timeline for host-owned reply, approval, and review behavior. A separate orchestration system would duplicate BB behavior; a visual redesign without better source data would leave the main usefulness gaps unresolved.

## Behavior

1. Needs attention shows the explicit question/approval target, age from its source timestamp, and a purpose-specific native-thread action. Failure items offer the execution timeline. Dismiss remains presentation-only.
2. A finished BB turn is labeled “Turn finished — review needed.” Structured goal completion is separately labeled; neither status nor agent prose is independent verification. Keep objective, observed changed paths, bounded final-only output, reported checks and safe result links available. Missing evidence is explicit.
3. Show operation and target instead of generic presentation labels. Expand observed child threads/native delegations with status, elapsed time, known model, output, and parent execution timeline. Do not assume opaque native child references are BB thread IDs or infer a model from the parent.
4. A per-browser catch-up baseline records bounded execution/attention fingerprints on successful visits. Return visits summarize observed new completions, failures and input requests; unrelated activity is not a new completion. Refreshes do not acknowledge unseen changes; Mark seen explicitly advances the baseline. First visit establishes it without inventing history; failed/partial snapshots do not erase prior observations.
5. Put compact work rows first; hide healthy diagnostics, release details and secondary filters behind disclosure. Persist bounded validated filter/grouping/time-window preferences and up to eight named saved views locally. Explain snapshot/history limits, retain absent selected options, and keep filtered rows/counts consistent while labeling the global attention scope.

## Constraints

No publishing, marketplace changes, or upgrade of the installed stable plugin is requested. Keep source changes reviewable on a feature branch. No new runtime dependencies. Redact/bound global summaries. Preserve adapter behavior and existing attention dismissal rules. Current SDK 0.6.132 still lacks a delegation model field; show unknown rather than inventing it. Keep the supported 0.4.34 development surface rather than bundling a separate SDK migration into this feature.

## Validation

Focused unit tests cover provenance, attention source timestamps, safe activity targets, catch-up transitions, corrupted/blocked storage and bounded saved views. UI tests cover native navigation, child expansion, compact disclosure and restoration after remount. Run the full existing suite, typecheck and BB build; verify the rendered desktop and narrow layouts where possible.
