# Marketplace update proposal — not submitted

Current reviewed entry: `get-bb/marketplace/entries/agent-board.json`, source
range `^0.6.1`. Preserve its id, source URL, category, author, icon and existing
reviewed synthetic screenshot. After 0.7.0 publication, propose:

```json
{
  "description": "Follow live BB agent activity, freshness, completion outcomes and monitoring health. Filter and group visible work by project, repository, provider or status. Optional Ollama Fleet and Redteam add worker visibility. Requires BB 0.40+; BB 0.46.0 recommended.",
  "source": {
    "git": {
      "url": "https://github.com/aaronphifer/bb-plugin-agent-board.git",
      "range": "^0.7.0"
    }
  }
}
```

This is a fragment describing edits to the existing entry, not a standalone
marketplace manifest. Copy the updated `PLUGIN_OVERVIEW.md` into
`overview/agent-board.md`. Compatibility remains in package engines; do not add
unsupported compatibility/version fields to the marketplace entry. Do not use
live validation screenshots containing private task details as listing media.

Existing installs retain their stored source range. Tell `^0.6.1` users to
select/reinstall the new marketplace release or use the `^0.7.0` Git command in
the upgrade notes. Do not ask them to uninstall, which would delete preferences.
Publishing only a `v0.7.0` tag will not move their existing 0.6.x selector.

No marketplace repository edits, PRs, submissions or announcements were made.
