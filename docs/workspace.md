# Workspace UI development build

The implementation lives on `feat/workspace-ui`. It is based on upstream 3.1.35;
there is no new tagged release. Office previews remain a later extension.

## Named Codex accounts

Account definitions live on each machine in
`~/.config/herdr-app/data/agent-profiles.json`. They are configuration, not source:
never commit authentication, personal home paths or this machine's profile file.
A role stores only the profile ID; the machine resolves its own definition.

```json
{
  "profiles": [
    {
      "id": "secondary",
      "name": "Codex (Account 2)",
      "agent": "codex",
      "home": "/path/to/secondary-codex-home"
    }
  ]
}
```

Use an absolute path to an existing, separately signed-in Codex home. Profiles use
that home's config, skills, MCP settings and model cache. Named profiles clear
inherited API-key and shared-database overrides before starting Codex. This keeps
separate ChatGPT logins separate; the account definitions contain no credentials.

In **Space settings → Agents**, select Codex and choose the account beside the
Assistant's model control. The account is assigned there, not in the chat composer.
A worker inherits the Assistant's account unless its role explicitly selects
another account. The regular Herdr program entries still determine which account
opens when starting a normal agent tab.

The chat composer shows the assigned account as a label, with separate **Model**,
**Thinking** and **Permissions** dropdowns. For a running agent, make the selections
and press **Apply** while it is idle. Applying these controls restarts the CLI
resuming the same conversation; simply switching **Chat / Terminal** does not
restart it. Model and reasoning options come from that account's Codex model cache.
If the cache is not available yet, start that CLI normally so it can populate it.

The installer records question-card hooks for configured Codex homes inside its
installation root. A profile outside that root needs its hooks configured
separately. Scratch-root tests never install hooks into an external home.

## Files and documents

**Files** stays as a tree for the selected space. **Folder…** assigns an explicit
local project root for that space, saved in `data/workspace-folders.json`. Switching
chat or document focus does not change it. Expanded folders and the selected file
are remembered per space/root.

Click a file to open it in a separate document pane. Further files open as tabs in
that pane. **+ Pane**, or Shift-click on a file, requests an additional pane.

- Markdown: **Source / Preview** switches between the editor and rendered content.
- CSV / TSV: **Source / Preview** switches between raw text and a table. Choose
  Auto, Comma, Tab or Semicolon for the delimiter. Arrow controls move through rows.
- Text and code: source editor with a language hint for Java, Bash, YAML and Helm
  templates. Actual highlighting depends on the grammars in the installed Herdr
  editor; Helm's mixed YAML/template syntax is not an IDE language service.
- Word and Excel: no dedicated preview in this build yet.

**Save** or Ctrl+S writes a local file only when its disk contents still match the
version loaded. Unsaved drafts are kept under `data/document-drafts/` and recovered
when reopening that file. A conflicting external change leaves the draft intact;
**Discard draft and reload** explicitly accepts the disk version. Clean views
refresh automatically. Remote files are read only.

Ctrl+Shift+P selects Preview; Ctrl+Shift+O selects Source in a document pane.
The equivalent commands are `workspace-document.preview`,
`workspace-document.source`, and `workspace-document.save`.

The editor accepts text up to 400,000 characters. CSV preview is bounded to 500
rows and 100 columns, showing up to 40 rows per page; Source retains the full file.
The tree retains the inherited limits of 500 entries per folder and 5,000 total.

## Installation and optional mods

Use [the contributor workflow](../CONTRIBUTING.md) for checks and a scratch-root
install before deploying into a live Herdr configuration. The fork installer uses
the selected local checkout; it does not automatically follow an upstream release.

Standalone Markdown preview mods can be retired after the new pane is verified.
Blueprint remains an independent optional mod; the fork does not bundle it.
