# dv

A git diff viewer. One Go binary that shells out to `git`, serves JSON and SSE
on loopback, and embeds a TypeScript single-page app that renders the diff.
Review comments land in a plain `comments.json`.

## Layout

| Path | Owns |
|---|---|
| `main.go` | entry point; embeds `web/dist`, wires everything together |
| `internal/gitx/` | **every** `git` invocation — revspecs, manifest, patches, blobs |
| `internal/server/` | routes, SSE, asset serving, token and origin guards |
| `internal/comments/` | the comments store, anchoring, exporters |
| `internal/model/` | JSON types shared with the frontend |
| `internal/config/` | flags and `~/.config/dv/config.toml` |
| `internal/cli/` | `dv comments list \| export` |
| `web/src/` | the SPA — no framework, plain DOM |
| `web/e2e/` | Playwright browser tests |

## Commands

```bash
make build       # web build + go build → bin/dv
make dev         # vite on :5173, dv on :8765 proxying to it
make test        # go test ./... + vitest
make typecheck   # tsc --noEmit
make fmt vet

make build && cd web && bun run test:e2e   # browser tests — see below
```

`go build` alone will not produce a working binary on a fresh clone: `web/dist`
has to be built first.

## Checking a change actually works

Unit tests do not exercise layout, scrolling, virtualisation, or the shadow DOM
the diff renders into. For anything visual or interactive, run the **browser
tests**: they build a throwaway repository with `web/e2e/fixture.sh`, start the
real binary against it, and drive chromium at the result. The diff under them is
fixed, so a test may name the file it wants.

```bash
bunx playwright install --with-deps chromium   # one time, from web/
make build                                     # required before every run
cd web && bun run test:e2e
```

Single test, headed, screenshots, and the rules for writing new ones are in
[docs/testing.md](docs/testing.md#browser-tests).

## Conventions

- **Go**: standard library only, apart from `fsnotify`. `gofmt` and `go vet`
  clean — CI fails on either.
- **Never run `git` outside `internal/gitx`.** Revisions and pathspecs are passed
  through to git verbatim; that is why pathspec magic works.
- **`internal/model` and `web/src/api/types.ts` are hand-mirrored.** Change one,
  change the other — nothing checks it for you.
- **TypeScript**: strict, no framework, no JSX. Components are `createX(deps)`
  factories returning `{ el, update, destroy }`; every subscription goes through
  a `createDisposer()`. Build DOM with the `core/dom.ts` helpers, never
  `innerHTML`.
- **CSS**: one stylesheet, `.dv-block__element--modifier`. Class names are the
  browser tests' hooks — renaming one means updating `web/e2e/`.
- **Comments in code** explain *why*, in prose, matching the density of the file
  you are in. Do not narrate what the code already says.
- **Shell**: bash builtins, `[[ ]]` over `[ ]`. POSIX compliance is not a goal.
- Do not attribute Claude or any agent in commit messages.

## Docs

- [Architecture](docs/architecture.md) — how a diff gets from `git` to the screen
- [Development](docs/development.md) — toolchain, dev loop, config, CI, release
- [Testing](docs/testing.md) — Go, vitest, and browser tests
- [HTTP API](docs/http-api.md) — routes, SSE events, the token
- [Frontend](docs/frontend.md) — SPA structure, store/bus, theming, keybinds
- [Comments](docs/comments.md) — file format and how anchors survive edits
