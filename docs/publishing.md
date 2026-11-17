# Publishing Yurherdr

## The right catalog

Yurherdr is a **Herdr App layout with mods and helper programs**. Its listing target
is the [Herdr App Gallery](https://herdr.dev/gallery/). The separately documented
[Herdr TUI marketplace](https://herdr.dev/tui/docs/marketplace/) uses
`herdr-plugin.toml` and `herdr-plugin`; those requirements do not turn this native
workspace into a TUI plugin. This repository does not ship a TUI plugin manifest.

The App Gallery's Share yours instructions call for a public repository tagged
`herdr-layout`, containing a layout folder with `layouts/<name>.json`, its mods,
`RECIPE.md` and `preview.png`. Discovery is automatic; the Gallery says to allow
up to an hour and notes that community pictures are screened. A prepared repository
is not proof that its card has appeared or that Herdr has reviewed its code.

## Listing identity

- **Display name:** Yurherdr.
- **Repository:** `yurtools/shepherdr` (unchanged).
- **Category:** Herdr App layout; use `herdr-layout`, not `herdr-mod` for the complete workspace.
- **Description:** An IDE-style workspace for coding agents in Herdr App: Chat / Terminal, Feature Assistants, named Codex accounts and document panes. Derived from Shepherdr.
- **Source of truth:** README for positioning, RECIPE for reconstruction, workspace guide for behavior and limits.
- **Version:** development code derived from Shepherdr 3.1.35; no new release tag implied.

The recipe begins with what the person sees, includes the preview, and explains
behavior, components, dependencies, installation and acceptance checks. A public
preview uses demo data rather than private project names, conversations or accounts.

## Screenshot set

Use a small set of real native-app screenshots with public sample data:

1. **Workspace overview:** show Spaces and Features, a feature conversation and a
   rendered document. Keep text readable and avoid an almost empty oversized pane.
2. **Feature coordination:** show two named features and their own worker/task
   context, making the distinction from the project-wide Assistant visible.
3. **Permission control:** show approval modes or history with its decision source,
   alongside a bounded rule's scope and expiry. Use a caption to identify staged
   sample history; it is not evidence that a live action ran.
4. **Repository changes** when useful: show two sample repositories with a selected
   file diff and the selected-repository commit destination.

The overview belongs in `preview.png`; additional captures can live under
`docs/images/` and be linked from the recipe near the feature they explain. Keep
source screenshots free of real project names, hostnames, account identities,
conversations and credentials rather than relying on blurred patches afterward.
Do not use generated artwork as evidence of the actual interface.

For a separate demo window, isolate its filesystem **and** its herdr-core sockets
and network, for example in a VM or a verified namespace sandbox. A different
`HERDR_APP_HOME` alone does not isolate the core's spaces. Do not start another
window against a live core or copy production credentials into a screenshot demo.

## Publishing changes

1. Update the docs, recipe and preview from implemented behavior. Order feature
   summaries by importance, not by when they were developed.
2. Keep upstream attribution and licenses. Check local Markdown links and ensure
   the layout and recipe do not contain live machine, task or account identifiers.
3. Put the reviewed code and listing files on the repository's default branch.
   Push normally; never rewrite shared history to make a listing.
4. Set the repository description and `herdr-layout` topic. Keep relevant descriptive
   topics such as `herdr`, `codex`, `developer-tools`, `linux`, `markdown` and `csv`.
5. Check the Gallery after its next refresh. Report indexing as pending until the
   actual listing is visible. No release, tag, version bump or TUI publication is
   required for this Gallery preparation.

## Should the repository be renamed?

`yurtools/yurherdr` would align the repository with the product name and distinguish
it from upstream. It is optional: the Gallery title comes from the recipe, so
`yurtools/shepherdr` can present Yurherdr today. The user has explicitly asked to
keep the repository name unchanged for now.

If a repository rename is later authorized, use GitHub's repository rename rather
than deleting and recreating it. Keep its history and attribution, update the
local `origin`, canonical clone/issue links and listing metadata, and retain
`upstream` pointing to Elias Stravik's repository. Verify existing redirects,
branch protection, CI and installation-source records afterward. Do not rename
storage paths, services, module IDs or the active checkout directory as a side
effect. GitHub's fork relationship is distinct from the repository's name; a name
change alone does not make a fork an independent repository.
