# Review Prompt

Use this prompt when asking Codex to review a pull request or local changes.

```text
Review these changes as a code reviewer.

Focus on:
- Bugs
- Behavioral regressions
- UI regressions
- Data structure changes
- Save/update/photo/history/storage/cloud sync risks
- Missing checks or tests
- Unnecessary refactors or dependencies

Do not rewrite the code unless I ask.

Output:
- Findings first, ordered by severity
- File and line references
- Open questions or assumptions
- Brief summary
```
