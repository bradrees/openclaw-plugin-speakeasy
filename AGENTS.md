# Agent Run Notes

## Git workflow
- Treat completed requested changes as commit-and-push work by default, including on `main`, unless the user explicitly says not to commit/push or the work is clearly incomplete or blocked.
- Do not leave completed requested changes only in the working tree. Commit and push the relevant files before stopping so multiple agents do not drift or overwrite each other.
- If unrelated local edits exist, commit only the files relevant to the current task.
- If partial work should be preserved before stopping, ask whether the user wants a WIP commit rather than deciding silently.
- If you change `AGENTS.md`, commit and push that change unless the user explicitly says not to.
