# HTTP API

Everything under `/api/` is JSON, guarded by the token, and defined by the types
in `internal/model` (mirrored in `web/src/api/types.ts`). Handlers live in
`internal/server`; `routes.go` is the index.

## Authentication

A random 32-byte token is minted per run — or taken from `DV_TOKEN` — printed on
stderr, and substituted into `index.html` in place of `__DV_TOKEN__`. The client
reads it back from `<meta name="dv-token">`.

Send it as either:

- `X-Dv-Token: <token>` header (`Sec-Dv-Token` is still accepted), or
- `?token=<token>` — necessary for `EventSource`, which cannot set headers

`/healthz` and the static assets are exempt. Comparison is constant-time. A miss
is `403`, not `401`.

Requests carrying an `Origin` that is not dv's own host are rejected with `403`
before routing.

## Routes

| Method | Path | Returns |
|---|---|---|
| `GET` | `/healthz` | `{status, version}` — no token needed |
| `GET` | `/api/session` | repo root, head, spec, CLI defaults, whether comments are on |
| `GET` | `/api/manifest` | `{files: FileEntry[], totals}` |
| `GET` | `/api/file/{id}` | `FilePayload` — patch plus full side contents |
| `GET` | `/api/stream` | SSE: the manifest and every file |
| `GET` | `/api/comments` | `{doc, etag}` |
| `POST` | `/api/comments` | creates one, returns `{comment, etag}` |
| `PATCH` | `/api/comments/{id}` | edits the body |
| `DELETE` | `/api/comments/{id}` | removes it and its replies |
| `POST` | `/api/comments/{id}/replies` | appends a reply |
| `GET` | `/api/comments/stream` | SSE: the whole document, re-pushed on change |

`{id}` for a file is `base64url(path)` — `gitx.FileID`. A malformed id is `400`,
an id not in the current manifest is `404`.

The manifest is cached for one second, so the tree, a file fetch, and the stream
never disagree mid-render.

## SSE

Both streams heartbeat every 15s and set `X-Accel-Buffering: no`.

**`/api/stream`** — the whole diff, pushed:

| Event | Payload |
|---|---|
| `manifest` | `Manifest` — always first |
| `file` | `FilePayload`, one per file, resolved by a pool of 2–8 workers |
| `file-error` | `{id, path, error}` when one file fails; the stream continues |
| `done` | `Totals` |
| `fatal` | `{error, detail}` — the manifest itself failed, nothing follows |

Files arrive in completion order, not manifest order. The client indexes by id.

**`/api/comments/stream`** — pushes a `comments` event (`{doc, etag}`)
immediately, then again whenever fsnotify sees `comments.json` change, debounced
80ms. That is what makes an external edit show up in the browser without a
reload.

Both streams count as connected clients for the idle timeout; `/api/stream`
ending does not, on its own, keep dv alive.

## Writes and conflicts

The comments document is versioned by an etag. A write that carries a stale etag
gets `409` and the client refetches — that is `ApiError.isConflict` in
`web/src/api/client.ts`.

Anchors are not taken on trust: `POST /api/comments` receives only
`{path, side, startLine, endLine}` and the server builds the full anchor itself
(`buildAnchor`), reading the blob to capture the sha, the quote, and three lines
of context on each side.

Request bodies are capped at 1MiB.

## Errors

Every failure is `{error, detail}` (`model.Error`). `respond.go:classify` maps
sentinels to status:

| Error | Status |
|---|---|
| `comments.ErrConflict` | 409 |
| `comments.ErrNotFound` | 404 |
| `comments.ErrInvalid` | 400 |
| `gitx.ErrNotFound` | 404 |
| anything else | 500 |

5xx is logged at error level, 4xx at debug.
