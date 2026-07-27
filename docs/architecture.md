# Architecture

dv is two halves in one binary: a Go process that talks to `git` and serves
JSON, and a TypeScript single-page app that renders the diff. The web build is
embedded with `//go:embed all:web/dist`, so a release is one file with no
runtime assets to find.

```
git ──▶ internal/gitx ──▶ internal/server ──▶ HTTP/SSE ──▶ web/src ──▶ browser
                              │
                              └── internal/comments ──▶ comments.json
```

## Startup

`main.go:run` is the whole boot, in order:

1. `dv comments …` short-circuits into `internal/cli` — no server, no browser.
2. `config.LoadFile` reads `~/.config/dv/config.toml`, then `config.Parse`
   layers flags on top. Anything dv does not recognise is left in `rest`.
3. `gitx.Open` finds the repo; `gitx.ResolveSpec` turns `rest` into a `RevSpec`
   — which side is which, plus the diff options and pathspecs to forward.
4. `comments.New` opens the store unless `--no-comments`.
5. The token comes from `DV_TOKEN` or a fresh 32 random bytes.
6. `server.New` gets the repo, spec, store, embedded assets, and token.
7. The manifest is built once up front so the summary line can be printed, and
   so `prepareComments` can re-anchor and prune before anyone connects.
8. `Listen` binds, `Serve` runs until SIGINT/SIGTERM or the idle timeout.

## internal/gitx — every subprocess

Nothing outside this package runs `git`. It is deliberately a thin shell over
the porcelain rather than a git implementation:

| File | Job |
|---|---|
| `repo.go` | discovery, `Author`, `Head`, the `Options` knobs |
| `revspec.go` | argv → `RevSpec`; decides worktree/staged/two-dot/three-dot |
| `raw.go` | parses `git diff --raw -z` into the manifest; `FileID` |
| `patch.go` | per-file `git diff` patch text |
| `blob.go` | `git cat-file --batch` for full side contents |

Revisions and pathspecs are handed to git verbatim, which is why pathspec magic
like `:(exclude)*.lock` works without dv understanding it.

A **file id** is `base64url(path)` (`gitx.FileID`). It is stable, URL-safe, and
doubles as the location hash the frontend routes on.

## internal/server — routes and streams

`routes.go` is the map. The middleware stack, outermost first, is
`secureHeaders → checkOrigin → trackActivity → mux`, and `/api/` additionally
sits behind `guardToken`. `/healthz` and the assets are exempt.

- **Manifest** is cached for one second (`manifestTTL`), so the tree, the file
  lookup, and the stream all agree without re-shelling per request.
- **`/api/stream`** pushes `manifest`, then one `file` event per file resolved
  by a worker pool (half your cores, clamped to 2–8), then `done`. It is how the
  UI gets everything without a request per file.
- **`/api/comments/stream`** watches `comments.json` with fsnotify (80ms
  debounce) and re-pushes the whole document on change, so an editor writing the
  file and the browser stay in sync.
- **`assets.go`** serves the embedded build, negotiating `.br`/`.gz` siblings,
  and substitutes `__DV_TOKEN__` in `index.html` for the run's token. Under
  `--dev-proxy` it reverse-proxies to Vite and injects the token into the
  response HTML instead.
- **`idle.go`** counts open SSE clients; with none for `--idle-timeout`
  (30m default) the process exits so stray servers do not pile up.

See [HTTP API](http-api.md) for the wire detail.

## internal/comments — the review layer

`comments.json` lives at the repo root by default and is meant to be either
committed or gitignored, the user's call. The store owns atomic writes, etags
for optimistic concurrency, quarantining an unreadable file to `.bak`, and
re-anchoring. [Comments](comments.md) covers the format and the anchor ladder.

## internal/model — the shared vocabulary

Every JSON type crossing the wire or landing in `comments.json` is declared once
here and mirrored by hand in `web/src/api/types.ts`. **Change one, change the
other** — nothing generates or checks that pairing.

## The frontend

`web/src/main.ts` wires a store, an event bus, an API client, and mounts the
shell; the loader opens `/api/stream` and feeds payloads in. Rendering is
`@pierre/diffs`' `CodeView`, a virtualising web component that owns its own
shadow DOM — dv supplies patch text, full side contents, theme, and annotations,
and reads back metrics. [Frontend](frontend.md) has the module map.

## Security posture

dv serves a readable copy of your working tree, so:

- binds `127.0.0.1` by default; `--host 0.0.0.0` is allowed but logs a warning
- a per-run random token guards `/api/`, accepted as the `X-Dv-Token` header or
  `?token=` (EventSource cannot set headers)
- cross-origin requests are rejected by `Origin` check
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
- request bodies are capped at 1MiB; blobs above `--max-blob` are not read

`internal/server/security_test.go` is the executable version of this list.
