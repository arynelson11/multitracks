---
name: release-deploy-flow
description: Where desktop installers are built and released, and what triggers the pipeline
metadata:
  type: reference
---

Desktop release pipeline: `.github/workflows/release.yml` ("Build & Release Desktop"). Triggered by pushing a tag matching `v*` (also `workflow_dispatch`). Builds on macos-latest + windows-latest via electron-builder, uploads installers as artifacts, then creates/updates a GitHub Release (softprops/action-gh-release, generate_release_notes).

So the release flow is: bump version in `package.json` + `src/lib/changelog.ts` → commit `chore(release): ... [vX.Y.Z]` → `git push origin main` → `git tag -a vX.Y.Z` → `git push origin vX.Y.Z` (tag push is what fires the build).

Actions/runs UI: https://github.com/arynelson11/multitracks/actions — `gh` CLI was NOT installed on this machine, so run IDs/links can't be fetched from the terminal; check the Actions tab in the browser.

Remote: `https://github.com/arynelson11/multitracks.git` (origin). Related: [[push-authority-hook]]
