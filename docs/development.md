# Development

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Go | 1.25 | the binary; CI pins 1.25 |
| bun | 1.3.14 | the web build, tests, and lockfile |
| git | any recent | dv shells out to it, and the tests build real repos |

Chromium for the browser tests is a separate one-time install — see
[Testing](testing.md).

## Make targets

```
make build       # bun install + vite build, then go build → bin/dv
make web         # just the web build → web/dist
make dev         # vite on :5173 and dv on :8765, wired together
make test        # test-go + test-web
make test-go     # go test ./...
make test-web    # vitest run
make typecheck   # tsc --noEmit
make fmt vet     # gofmt, go vet
make clean       # bin/, web/dist/*, web/node_modules
```

`go build` alone fails on a fresh clone: `//go:embed all:web/dist` needs the
directory to exist and hold something. `web/dist/.gitkeep` is committed so the
embed compiles, and the binary then serves a "run `make web`" notice instead of
a blank page. Build the web side first for a real binary.

## The dev loop

`make dev` runs two processes:

- Vite on `:5173` with HMR, proxying `/api` to `:8765`
- `go run . --dev-proxy http://localhost:5173` on `:8765`

Either URL works. Hitting dv on `:8765` is the truer test — dv proxies asset
requests to Vite and injects the token into the HTML on the way through, so the
token path behaves exactly as it does in a release build.

For Go-only changes, `go run . <revspec>` against the last `make web` output is
faster.

## Configuration

Flags always win over the file at `$XDG_CONFIG_HOME/dv/config.toml` (or
`~/.config/dv/config.toml`). The parser in `internal/config/file.go` is a
deliberate ~10-key subset of TOML, not a real one; adding a key means adding it
to `applyKey` and to `Config`.

```toml
host = "127.0.0.1"
port = 8765
theme = "auto"          # auto | latte | frappe | macchiato | mocha
view = "split"          # split | unified
wrap = false
untracked = false
no_open = false
max_blob = "2MiB"
comments = "comments.json"
idle_timeout = "30m"
```

Environment:

- `DV_TOKEN` — pin the API token instead of a random per-run one. The e2e suite
  uses this.
- `DV_LOG` — `debug|info|warn|error`, default `warn`.

## CI

`.github/workflows/ci.yml` runs four jobs:

1. **go** — `gofmt -l` must be empty, `go vet ./...`, `go test -race -count=1 ./...`
2. **web** — `bun run typecheck`, `bun run test`, `bun run build`, uploads `web/dist`
3. **e2e** — downloads that `dist`, builds the binary, installs chromium, runs Playwright
4. **build** — cross-compiles the five release targets

Note the e2e job checks out with `fetch-depth: 2`, because the suite diffs the
repo's own `HEAD~1`.

`.github/workflows/release.yml` fires on `v*` tags: builds the web assets, cross
compiles linux/darwin amd64+arm64 and windows amd64, writes `SHA256SUMS`, and
publishes a GitHub release. The version comes from the tag via
`-X main.version=`.

## Before you commit

```
make fmt vet test typecheck
```

Plus the browser tests if you touched the viewer, the rail, the comment UI, or
anything in `internal/server`.
