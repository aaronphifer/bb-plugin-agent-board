# Daily monitoring and updates

Agent Board’s global view puts attention and active work before diagnostics. Views and filters remembers project, repository, workspace, provider, status, grouping and recent-history choices in the current browser. Save up to eight named views. A missing filter value remains selectable and resettable when it falls outside the current snapshot.

## Attention and review

An explicit question offers **Reply**; an approval offers **Review approval**; a failure offers **Inspect failure** and its timeline. These actions open BB’s native interaction surface. Dismiss only hides the current condition.

Completed BB turns say **Turn finished — review needed**. An explicit completed goal is labeled separately. Neither means independent verification. Review shows the structured objective when available, observed changed paths, safe reported result links, agent-reported checks and source output. BB’s current output API does not distinguish final answers from interim assistant updates, so previews are labeled accordingly. Changed paths are observations from the bounded timeline, not a complete Git diff.

**Observed agents** expands children and native delegations with reported status, elapsed time, activity and output. Native delegations open the owning execution timeline; provider references are not treated as BB thread IDs. Model information stays unavailable when the public API does not supply it.

## Since you last checked

The browser stores bounded state fingerprints, not a transcript. On a return visit the digest shows newly observed completions, failures, interruptions and requests for input. **Mark seen** acknowledges the current observations. Leaving the view also records the successful observations from that visit. Incomplete snapshots preserve earlier observations so recovered results can still appear. This is a snapshot comparison; events that begin and end outside retained source history cannot be reconstructed.

## Timeline history

**Timeline** opens a scrollable execution history. It initially loads the newest page; **Load earlier activity** retrieves earlier BB history while retaining the events already loaded and preserving the visible scroll position. The counter shows how many events are loaded. Each request returns at most 80 normalized events, so long histories are read incrementally rather than downloaded all at once.

Pagination handles both BB's native source-page cursor and events omitted within a source page. Live updates merge by event identity. A reconnect that introduces a gap first bridges back to known events before resuming the earlier-history cursor. Temporary failures keep the visible history and offer retry. The dialog follows new events only while the user is near the newest activity; **Jump to latest** returns there.

This browses BB's retained public operational history, not raw model reasoning or an independent archive. Redteam and Ollama Fleet still expose bounded retained snapshots without a historical API; when earlier source data is unavailable, the timeline says so.

## Update available

Both global and thread boards check for updates when opened. Public GitHub release discovery uses the fixed official Agent Board repository, no credentials, a five-second deadline and a bounded response. Results are shared across clients and cached for an hour (fifteen minutes after a discovery failure). BB separately decides whether an eligible update exists for the installed source and current compatibility rules.

- **Review update** shows BB’s eligible candidate and asks for confirmation.
- **Install update** rechecks eligibility and calls BB’s existing update operation. It does not remove or reinstall the plugin. BB owns activation and rollback checks.
- The current SDK cannot bind the install atomically to a reviewed release: BB resolves again at apply time. The confirmation states this limitation. An update request that fails during plugin reload does not pretend success; reopen the board to verify the installed version before retrying.
- Out-of-range or unavailable candidates remain advisory. The card links to official release notes and explains the native limitation; it does not silently widen the selected source.
- Dismissal applies to that update identity in this browser. A different release or eligible candidate appears again.

Existing installations must receive the notifier before it can announce anything. To reach a `^0.6.1` installation, publish a compatible 0.6.x patch containing the notifier; a `^0.7.0` installation similarly needs a compatible 0.7.x patch. A later major/minor release alone cannot add UI to an older installed build. Patch backports and publication are separate release work; this implementation does not publish or rewrite marketplace ranges.
