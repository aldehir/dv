# Comments

dv can take review notes against a diff and keep them in a JSON file — by
default `<repo-root>/comments.json`, overridable with `--comments`, off entirely
with `--no-comments`. The file is plain text on purpose: commit it to share a
review, or gitignore it to keep it local. dv prints that choice the first time it
writes one.

## The file

`model.CommentsDoc`:

```json
{
  "version": 1,
  "generator": "dv/0.1.0",
  "repo": { "root": "/home/you/project", "head": "<sha>" },
  "spec": { "kind": "commit", "left": "<sha>", "right": "", "argv": ["HEAD~1"] },
  "updatedAt": "2026-07-27T05:08:00Z",
  "comments": [
    {
      "id": "cmt_…",
      "author": { "name": "…", "email": "…" },
      "createdAt": "…", "updatedAt": "…",
      "body": "…",
      "anchor": {
        "path": "internal/server/routes.go",
        "prevPath": null,
        "side": "additions",
        "startLine": 42, "endLine": 44,
        "blobSha": "<40 hex>",
        "lang": "go",
        "quote": "the exact lines, verbatim",
        "contextBefore": ["…"], "contextAfter": ["…"]
      },
      "replies": []
    }
  ]
}
```

`side` is `additions` (the new file) or `deletions` (the old one).
`startLine: 0` means the comment is attached to the file rather than a line.

`resolvedAnchor` is computed at load, never persisted as truth — see below.

## How the store behaves

`internal/comments/store.go`:

- **Atomic writes** — temp file plus rename, so a crash cannot truncate a review.
- **Etags** — every read hands back a 32-char etag; a write with a stale one
  fails `ErrConflict` and the caller refetches. That is what lets the browser and
  an editor both write.
- **Quarantine** — an unparseable `comments.json` is moved to `comments.json.bak`
  and a fresh one is started, with a line on stderr. It never silently discards.
- **Watch** — `Watch` uses fsnotify on the containing directory with an 80ms
  debounce, which is what feeds `/api/comments/stream`.

The server never trusts a client-supplied anchor: `POST /api/comments` sends only
`{path, side, startLine, endLine}` and `buildAnchor` reads the blob to capture
the sha, the quote, and three lines of context on each side.

## Anchoring

A comment written against one revision has to survive being reopened against
another. `internal/comments/anchor.go` walks a ladder per comment, recording
which rung matched in `resolvedAnchor.rule`:

| Rule | Meaning |
|---|---|
| `exact` | the side's blob sha is unchanged — nothing to do |
| `file-level` | `startLine == 0`, so there is no line to lose |
| `quote` | the quote matched exactly once; re-anchored to where it now sits |
| `quote-whitespace` | matched once after squeezing whitespace |
| `ambiguous` | the quote matched more than once — stale |
| `gone` | the quote no longer appears — stale |
| `no-quote` | nothing to search with — stale |
| `unresolved` | neither `path` nor `prevPath` reads on that side — stale |

When a match moves the comment, `movedFrom` records where it used to be, so the
UI can say so.

`PruneStale` then drops two kinds of comment: those whose anchor did not resolve,
and those on a file the current diff does not touch. The second is the subtle
one — such a comment resolves perfectly well, its blob is right there in the
tree, but the diff has no row to hang it on and it would only clutter the inbox.
`main.go:prepareComments` runs this before the server starts and reports the
count on stderr.

## The CLI

Neither subcommand starts a server or a browser:

```bash
dv comments list                      # everything, with anchors and status
dv comments list --path 'internal/*'  # filter by glob or prefix
dv comments export --format md        # markdown, default
dv comments export --format json      # the raw document
dv comments export --format prompt    # shaped for pasting to an LLM
dv comments export -o review.md
dv comments export --comments other.json
```

`--format prompt` is the one to reach for when handing a review to an agent: it
renders each comment with its file, lines, and quoted code as context.

## Working on this code

- Anchor rules are pure functions over `(lines, anchor)` —
  `internal/comments/anchor_test.go` covers each rung; add a case there when you
  add a rung.
- Store behaviour (atomicity, etags, quarantine) is `store_test.go`; the watcher
  is `watch_test.go`.
- The round trip through HTTP is `internal/server/comments_test.go`, and the
  full path — select lines, save, reload, assert the file on disk — is the
  `comment survives a reload` browser test in `web/e2e/smoke.spec.ts`.
