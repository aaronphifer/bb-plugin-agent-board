# Release notes convention

This work is unreleased. `0.7.0` is prepared on the development PR branch after
the RC hardening/CI gates passed. It is not a public tag, release, marketplace or
production update. The changelog preparation date is not a publication date.

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

The UI reads only bundled notes, never GitHub or the marketplace. Dismissal is
stored in plugin KV for the exact version (latest 20 dismissed versions), so
reloads retain dismissal, upgrades show new notes, and a recent downgrade
retains its old dismissal. Release notes can be opened later from the dashboard.
Storage failures are shown, not silently treated as saved.
