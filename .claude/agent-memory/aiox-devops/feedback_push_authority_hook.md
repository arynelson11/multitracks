---
name: push-authority-hook
description: How to satisfy the git-push authority hook when running as @devops in this repo
metadata:
  type: feedback
---

To run `git push` / `gh pr create` / `gh pr merge` in this repo, the PreToolUse hook `.claude/hooks/enforce-git-push-authority.cjs` requires the active agent to resolve to devops, or it denies with "exclusive to @devops (Constitution Article II). Current agent: @unknown."

Prefix the command inline: `AIOX_ACTIVE_AGENT=devops git push origin <ref>`. The hook parses that env assignment from the command string (`getCommandScopedAgent`). Accepted aliases: devops, @devops, github-devops, aiox-devops.

**Why:** A bare `git push` gets blocked because spawned agent sessions don't export an agent env var, so the hook sees @unknown.
**How to apply:** Only as the @devops agent on an authorized push/PR task. Don't use it to bypass authority from other personas — it's a declaration of identity, not an override.

Related: [[release-deploy-flow]]
