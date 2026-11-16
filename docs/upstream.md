# Upstream provenance

This repository is an independent fork of
[eliasstravik/shepherdr](https://github.com/eliasstravik/shepherdr), created by
Elias Stravik. Its starting runtime is Shepherdr **3.1.35**, commit
[`abd5a0f1aa6faf2d0ee8d6559dc7f064fdae488e`](https://github.com/eliasstravik/shepherdr/commit/abd5a0f1aa6faf2d0ee8d6559dc7f064fdae488e).

The [original README at that baseline](https://github.com/eliasstravik/shepherdr/blob/abd5a0f1aa6faf2d0ee8d6559dc7f064fdae488e/README.md)
describes the inherited task orchestration, Assistants, chat, terminal, artifacts
and web application. It is historical reference, not a description of completed
fork-specific features.

The existing [changelog](../CHANGELOG.md) and version strings currently describe
upstream releases. No fork-specific release or version bump has been made.
The [fork plan](fork-plan.md) records the proposed differences.

## Inherited documentation

The install, settings, add-ons, web and development guides describe the inherited
runtime unless a fork-specific note says otherwise. Screenshots, launch videos
and the gallery recipe's layout description likewise represent upstream behavior;
they are not proof of the planned workspace UI.

The installer installs from a local checkout. Its update command uses the
recorded source checkout (or an explicit `--source`), not a fresh download from
this fork's default branch. Verify the checkout and branch before an update.
The fork's update and installation paths will be validated again when runtime
changes are ready.

## Attribution

The original [MIT license](../LICENSE) and
[Herdr-related license](../LICENSE-herdr) remain in the repository.
The fork does not claim authorship of upstream code or endorsement from Herdr
or the upstream maintainer. Upstream repository references in historical release
notes and copyright material are intentional.
