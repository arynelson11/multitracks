---
name: release-deploy-flow
description: Where desktop installers are built and released, and what triggers the pipeline
metadata:
  type: reference
---

Desktop release pipeline: `.github/workflows/release.yml` ("Build & Release Desktop"). Triggered by pushing a tag matching `v*` (also `workflow_dispatch`). Builds on macos-latest + windows-latest via electron-builder, uploads installers as artifacts, then creates/updates a GitHub Release (softprops/action-gh-release, generate_release_notes).

So the release flow is: bump version in `package.json` + `src/lib/changelog.ts` → commit `chore(release): ... [vX.Y.Z]` → `git push origin main` → `git tag -a vX.Y.Z` → `git push origin vX.Y.Z` (tag push is what fires the build).

Web deploy is separate and automatic: the Vercel project `playback-studio` (org `aio-developers1` / `team_iVdD3pBtnVG4xW3V0tLNdg0b`, linked via `.vercel/repo.json`) auto-deploys Production on every push to `main` through GitHub git integration. No manual `vercel --prod` needed. Prod domains `playbackstudio.com.br` + `www.playbackstudio.com.br` (aliases follow the newest Ready deployment). Verify with `vercel ls playback-studio` / `vercel inspect <url>` (CLI at `~/.nvm/.../bin/vercel`, logged in as arynelson11).

**Web-only deploy nuance:** normal convention is ship web + desktop together, but Ary sometimes asks web-only (e.g. 2026-07-09 v1.4.4 responsive fix). Problem: pushing the `v*` tag STILL fires the desktop build workflow. To honor web-only, push main + tag as usual, then immediately `gh run cancel <id>` the queued "Build & Release Desktop" run — the tag stays on remote for versioning, Vercel web deploy proceeds untouched. `gh` CLI IS installed and authed on this machine now.

Actions/runs UI: https://github.com/arynelson11/multitracks/actions

Remote: `https://github.com/arynelson11/multitracks.git` (origin). Related: [[push-authority-hook]]
