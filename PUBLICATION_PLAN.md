# Public release plan — approval required

Version: 0.6.1, first public beta. Target: https://github.com/aaronphifer/bb-plugin-agent-board (public).
Default branch: main. Tag: v0.6.1. License: MIT.

Publish Ollama Fleet first, then Agent Board. Fleet is standalone; Agent Board
is standalone with optional Fleet >=0.6.0 and optional Redteam integration.

Phase 9A stages files and runs clean-export checks locally. It does not create
repositories, remotes, tags, releases, public settings, npm packages, or PRs.
The exact final source SHAs, evidence, manifest and commands are supplied in the
separate local Phase 9A report. Publication requires the owner's explicit
`APPROVE PHASE 9B PUBLICATION` instruction after reviewing that report.

## History and release source

Fleet may use its complete audited history. Agent Board must use a separate
tracked-tree export with one sanitized initial commit. Preserve the original
Agent Board repository and its private development history locally; never push
that history, rewrite it, or attach it to the public repository.

## Publication sequence after approval

Verify GitHub CLI identity is exactly `aaronphifer`; stop on a mismatch. Verify
the approved source SHA and clean tree. Create the public repository, add its
remote to the approved publication source only, push the intended branch, then
create and push v0.6.1. Create the GitHub prerelease using RELEASE_NOTES.md.
Enable GitHub Private Vulnerability Reporting and verify it. Verify repository,
release, history, media and links anonymously, then validate a fresh public clone.
Repeat for Agent Board only after Fleet succeeds.

## Distribution

Git installation builds source using BB's managed installer. Keep `dist/`
untracked. Local path installs require prepared dependencies. npm installation
requires prebuilt artifacts and separate approval; npm publication is deferred.

## Community listing

The current directory is https://github.com/get-bb/marketplace. Prepare separate
entries for `ollama-fleet` and `agent-board` using the current v2 entry schema,
public Git tag ranges, category, author, icon, overview and reviewed media.
A submission is a pull request and requires explicit community-listing approval
in addition to public-release approval. Validate the current contract again
before submission. No community PR is opened during Phase 9A.
