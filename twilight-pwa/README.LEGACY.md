# twilight-pwa/ — LEGACY / DO NOT EDIT

This subdirectory is a **stale snapshot** from an earlier refactor and is **not**
loaded by the running application.

The live entry point is:
- `/index.html` (repo root) → `js/app.js` (repo root)

The files inside `twilight-pwa/js/` are **not** referenced by:
- the root `index.html`
- the root `sw.js` cache manifest
- any `import` statement in the active codebase

### What to do

- **Editing** anything in here has **no effect** on the deployed app.
- If you want to change behaviour, edit the files in `/js/…` instead.
- This directory is slated for deletion — no new work should be added here.

### Why it still exists

It is kept only so diffs against the pre-refactor baseline remain reviewable.
When the refactor is signed off, delete this whole directory in one commit.
