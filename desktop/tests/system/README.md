# Desktop System Tests

Run the desktop system tests with:

```bash
npm run test:system:install
npm run test:system
```

These tests load the real React app in a browser and replace Tauri APIs with a
small in-memory test backend. They assert intended product behavior, not the
current bug-for-bug behavior.

Known product bugs should be recorded in `known-bugs.ts` with:

- `id`: stable bug id used by tests.
- `title`: short human-readable summary.
- `status`: `open` or `fixed`.
- `expectedBehavior`: the behavior the product should have.
- `currentBehavior`: the known broken behavior.
- `linkedTest`: spec file or test title that documents the bug.
- `removeFailWhenFixed`: what to remove when the bug is fixed.

Write the test for the correct behavior, annotate it with the bug id, and use
Playwright's `test.fail()` while the bug is open. When the bug is fixed, remove
`test.fail()` and keep the test as a regression check.

Real integration tests are separate from these mocked system tests:

```bash
npm run test:integration:desktop
```

They require conda env `bearfrp_test`, current-platform sidecars, and write logs
under `test-results/integration/`.
