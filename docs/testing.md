# Testing

Three layers, three tools:

| Layer | Tool | Where | Run |
|---|---|---|---|
| Go units + HTTP | `go test` | `internal/**/*_test.go` | `make test-go` |
| Frontend units | vitest (jsdom) | `web/src/**/*.test.ts` | `make test-web` |
| **Browser** | Playwright + chromium | `web/e2e/*.spec.ts` | `cd web && bun run test:e2e` |

`make test` runs the first two. The browser tests are separate because they need
a built binary and a real chromium.

## Go tests

```bash
go test ./...                                   # everything
go test -race -count=1 ./...                    # what CI runs
go test ./internal/server -run TestTokenGuard -v # one test
go test ./internal/gitx -v                       # one package
```

The git-touching packages build **real repositories in a temp dir**, not
mocks — see `internal/gitx/fixture_test.go` and `internal/server/fixture_test.go`.
`hermeticEnv` pins `GIT_CONFIG_GLOBAL`/`SYSTEM` to `/dev/null`, fixes the author
and dates, and points `HOME`/`XDG_CONFIG_HOME` at temp dirs, so a developer's
`~/.gitconfig` cannot change an outcome. Write new git tests through the fixture
rather than shelling out yourself.

`internal/server` tests drive the real handler through `httptest`; the harness
in `fixture_test.go` seeds a repo, builds a `Server`, and hands you `request()`.
Golden payloads live in `internal/server/testdata/`.

## Frontend unit tests

```bash
cd web
bun run test                        # vitest run
bunx vitest                         # watch mode
bunx vitest run src/diff/rail.test.ts
bunx vitest run -t "drags the box"
```

Tests sit next to the module they cover (`rail.ts` ↔ `rail.test.ts`). The
environment is jsdom, and `src/test-setup.ts` shims `CSSStyleSheet.replaceSync`
and `adoptedStyleSheets`, which jsdom lacks and the diff library requires. Some
suites stub `ResizeObserver` themselves.

jsdom does no layout: anything that depends on real geometry — scroll offsets,
bounding boxes, drag maths, virtualisation — belongs in a browser test instead.

## Browser tests

This is how you check that a change actually works in a real browser against a
real diff, rather than against jsdom's approximation of one.

### What they do

`web/playwright.config.ts` starts the **real binary** as its web server:

```
./bin/dv --no-open --host 127.0.0.1 --port 8799 --idle-timeout 0 \
         --comments /tmp/dv-e2e-comments.json HEAD~1
```

So the suite reviews **this repository's own last commit**. Chromium then drives
that page. `DV_TOKEN=e2e-token` pins the token, and `e2e/global-setup.ts` wipes
the comments file (and its `.bak`) before the run so comment tests start clean.

### One-time setup

```bash
cd web
bunx playwright install --with-deps chromium
```

The config deliberately does not pin a chromium build number — it scans
`~/.cache/ms-playwright` and reuses the newest `chromium-*` it finds, so
reinstalling browsers does not break the suite.

### Running

```bash
make build                    # required: the config runs ./bin/dv
cd web
bun run test:e2e              # the whole suite

bunx playwright test e2e/rail.spec.ts          # one file
bunx playwright test -g "drags the diff"       # one test by name
bunx playwright test --headed                  # watch it happen
bunx playwright test --debug                   # step through, inspector
bunx playwright test --reporter=html && bunx playwright show-report
```

**Rebuild before every run.** The binary embeds `web/dist`, so a frontend change
you have not run `make build` over is invisible to the browser tests.

### Seeing the UI

`page.screenshot({ path: 'test-results/whatever.png' })` writes into
`web/test-results/`, which is gitignored. `e2e/rail.spec.ts` already does this
for the drag, and it is the quickest way to eyeball a visual change:

```ts
await page.screenshot({ path: 'test-results/my-change.png', fullPage: false });
```

For an interactive poke rather than a test, `make build && ./bin/dv HEAD~1`
opens the same thing in your own browser.

### Current suites

- `e2e/smoke.spec.ts` — the diff renders and tokenizes, catppuccin reaches the
  code surface, split/unified toggling, expanding unchanged context, no console
  errors while scrolling, a comment surviving a reload and landing in
  `comments.json`, and the draft box tracking a selection drag.
- `e2e/rail.spec.ts` — the hunk rail as a scrollbar: drag, track press, wheel
  forwarding, tick jumps.

### Writing one

- Put it in `web/e2e/*.spec.ts`. Locate chrome by its `.dv-*` class or by role.
- **Diff content lives in a shadow root.** `diffs-container` owns its DOM, so
  Playwright locators reach it fine, but anything reading attributes or styles in
  bulk needs `page.evaluate` with `container.shadowRoot?.querySelectorAll(...)` —
  see the `countTokenSpans` helper in `smoke.spec.ts`.
- **Only what is on screen is rendered.** The viewer virtualises. Click a file
  row and press `]` to step to a hunk before asserting on lines.
- **Do not assume which files the diff contains.** It is whatever the last commit
  touched. `smoke.spec.ts` filters for a `.ts|.go|.css|.md` file precisely
  because the first entry may be a lock file shiki has no grammar for.
- The suite is `workers: 1, fullyParallel: false` on purpose — one server
  process, one comments file. Keep it that way.
- Prefer `expect.poll` over `waitForTimeout` for anything the app resolves
  asynchronously.

### Known flaky, as of `4dc6e0a`

Two tests do not pass reliably on a local run, both timing-sensitive rather than
broken-by-your-change:

- `rail.spec.ts` › *sends the box to a press on the track* — fails every time in
  isolation, passes some full runs. `beforeEach` only waits for the first
  `diffs-container` and the rail to be visible, so the track press can land
  before enough of the diff has streamed in for the mount to be scrollable.
- `smoke.spec.ts` › *the draft box follows the selection without chasing the
  drag* — fails at different assertions from run to run.

Confirm against a clean tree before assuming you caused a failure here.

### When it fails

Locally the reporter is `list`; re-run the single failing test with `--headed`
or `--debug`. In CI the reporter is `github` and `web/playwright-report` is
uploaded as an artifact on failure. Playwright also drops an
`error-context.md` under `web/test-results/<test-name>/` describing the page
state at the failure.

## What to run when

| You changed | Run |
|---|---|
| `internal/gitx`, `internal/comments`, `internal/config` | `make test-go` |
| `internal/server` | `make test-go` and the browser tests |
| `web/src` logic (store, router, anchors, api) | `make test-web typecheck` |
| `web/src` rendering (viewer, rail, thread, shell, styles) | `make test-web` **and** the browser tests |
| anything, before pushing | `make fmt vet test typecheck` |
