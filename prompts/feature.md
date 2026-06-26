# Feature Prompt

Use this prompt when asking Codex to implement a feature.

```text
Implement the following feature:

[Describe the feature]

Scope:
- [List files, screens, components, or services involved]

Rules:
- Do not change app behavior unless explicitly required.
- Do not change UI unless explicitly required.
- Do not change existing data structures unless explicitly required.
- Do not modify save/update/photo/history/storage/cloud sync behavior unless explicitly required.
- Do not add unnecessary dependencies.
- Reuse existing project patterns.
- Keep changes scoped to this feature.
- Run npm run check before finishing.

After implementation, summarize:
- What changed
- Files changed
- Verification performed
- Any risks or follow-ups
```
