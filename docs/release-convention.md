# Release notes convention

The public release line is 0.7.x. Verify current tags and GitHub releases before
choosing a new version; never move an existing release tag. Local preparation
and a changelog date do not by themselves constitute publication.

For each approved release:

1. Finalize the `Unreleased` section of CHANGELOG.md, with user-facing changes,
   relevant fixes, compatibility and known limitations. Move it to a versioned
   section with the actual release date; keep earlier sections intact.
2. Set package.json and the lockfile root to the same version. `lib/releases.ts`
   imports that package version and provides the bundled announcement title and
   highlights. Do not include unverified test claims in those highlights.
3. Put the complete human-facing notes in RELEASE_NOTES.md, led by the new
   version. Keep previous notes below it. Link compatibility/testing evidence.
4. Use GitHub release title `Agent Board vX.Y.Z`, tag `vX.Y.Z`, and copy the
   finalized release notes into its body. Keep pre-release builds marked as
   pre-releases. A repository tag/release or marketplace change requires the
   maintainer's explicit approval; this convention grants none.

The What’s New UI reads bundled highlights; the separate update card checks
GitHub release metadata and BB-eligible candidates. Announcement dismissal is
stored in plugin KV for the exact version (latest 20 dismissed versions), so
reloads retain dismissal, upgrades show new notes, and a recent downgrade
retains its old dismissal. Release notes can be opened later from the dashboard.
Storage failures are shown, not silently treated as saved.
