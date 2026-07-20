## Summary

Briefly describe what this PR changes and **why**. Link any related issue
(e.g. `Closes #123`).

## Type of change

- [ ] Bug fix
- [ ] New command condenser
- [ ] Change to existing condenser output
- [ ] New / changed public API
- [ ] Docs / tooling only

## Checklist

- [ ] `npm test` passes.
- [ ] `npm run typecheck` and `npx tsc -p tsconfig.test.json --noEmit` pass.
- [ ] New or changed behavior is covered by cases in
      `test/handlers/<name>.cases.test.ts` (via the shared harness).
- [ ] Any snapshot updates are intentional and explained below.
- [ ] Changes work cross-platform (CI runs on Windows too).
- [ ] No new runtime dependencies were added (Node built-ins only).

## Output / snapshot changes

If this PR changes how any command's output is condensed, describe the
before/after and why the new output is correct.

## Additional notes

Anything reviewers should know.
