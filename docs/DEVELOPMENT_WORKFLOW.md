# Development Workflow

This project uses an approval-based workflow. Work should move through a pull request and should not be merged until the user approves it.

## Steps

1. Create a feature branch.
2. Implement the feature with Codex.
3. Run `npm run check`.
4. Open a pull request.
5. Complete the PR checklist.
6. User reviews and approves.
7. Merge only after approval.

## Feature Branches

Create a branch for each focused change:

```sh
git checkout -b feature/short-description
```

Keep each branch scoped to one request. Avoid unrelated refactors, dependency upgrades, formatting churn, or behavior changes.

## Codex Implementation

When using Codex, provide the goal, scope, and constraints. Ask Codex to preserve existing behavior unless the feature explicitly requires a change.

Codex should:

- Read the relevant files before editing.
- Prefer existing project patterns.
- Keep changes scoped.
- Run `npm run check` before handoff.
- Explain what changed and what was verified.

## Pull Requests

Open a PR after local checks pass. The PR should include a concise summary, checklist status, and any risks or follow-up notes.

The user must review the PR and explicitly approve it before merge.

## Merge Policy

Do not merge a PR until:

- `npm run check` passes locally or in CI.
- The PR checklist is complete.
- The user has approved the PR.

Approval is required even for small changes.
