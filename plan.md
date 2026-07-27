# dv — a git diff viewer in the browser

`dv` is a single statically-linked Go binary. Run it in a repo, it resolves a
`git diff`-style argument list, starts a loopback HTTP server, opens a browser,
and renders the diff with `@pierre/diffs` `CodeView`, Catppuccin themes, and
Victor Mono. Line-range comments are persisted to a `comments.json` designed to
be handed straight to a coding agent.

---

## 1. Goals / non-goals

**Goals**

- `dv` accepts the same revision/pathspec grammar as `git diff`.
- Rendering via the `CodeView` component from `@pierre/diffs` (https://diffs.com/docs#code-view).
- One `go build` output; all JS/CSS/fonts embedded via `embed.FS`. No CDN, no runtime node.
- Catppuccin Latte / Frappé / Macchiato / Mocha, applied to **both** the code surface and app chrome.
- Victor Mono self-hosted, incl. its cursive italics for comments.
- Comment on a line or line range; persist to `comments.json` in a schema an
  agent can consume directly — and write back to.

**Non-goals (v1)**

- Editing or staging hunks.
- Remote/multi-repo hosting, auth. Binds to `127.0.0.1` only.
- Multi-user/realtime collaboration on comments (single local user assumed).
- Static single-file HTML export (see §12, stretch).

---

## 2. Research findings (verified, pin these)

| Fact | Value |
| --- | --- |
| Package | `@pierre/diffs@1.2.12` (npm), MIT-ish OSS, repo `pierrecomputer/pierre` |
| Entrypoints | `.` (**vanilla + utils — what we use**), `/react`, `/ssr`, `/worker` |
| Peer deps | `react`, `react-dom` — **peer only, not installed**; the vanilla entrypoint never imports them |
| Bundled dep | `shiki ^3 \|\| ^4` → resolves to **4.3.1** |
| Docs source of truth | `https://diffs.com/llms-full.txt` (the HTML docs page is a 12 MB RSC blob; the llms file is the readable one) |

Key API shapes actually confirmed from the shipped `.d.ts`:

```ts
// @pierre/diffs
type DiffsThemeNames = BundledTheme | (string & {});

type CodeViewItem<T = undefined> = CodeViewFileItem<T> | CodeViewDiffItem<T>;
type CodeViewDiffItem<T> = {
  type: 'diff'; id: string; fileDiff: FileDiffMetadata;
  annotations?: DiffLineAnnotation<T>[]; collapsed?: boolean; version?: number;
};
type CodeViewFileItem<T> = {
  type: 'file'; id: string; file: FileContents;
  annotations?: LineAnnotation<T>[]; collapsed?: boolean; version?: number;
};

// vanilla CodeView — a plain class, no framework
declare class CodeView<T = undefined> {
  constructor(options?: CodeViewOptions<T>, workerManager?: WorkerPoolManager);
  setup(root: HTMLElement): void;
  setItems(items: readonly CodeViewItem<T>[]): void;
  addItem(item: CodeViewItem<T>): void;
  addItems(items: readonly CodeViewItem<T>[]): void;
  getItem(id: string): CodeViewItem<T> | undefined;
  updateItem(item: CodeViewItem<T>): boolean;
  updateItemId(oldId: string, newId: string): boolean;
  setOptions(options: CodeViewOptions<T> | undefined): void;
  scrollTo(target: CodeViewScrollTarget): void;
  setSelectedLines(sel: CodeViewLineSelection | null, o?: SelectionWriteOptions): void;
  getSelectedLines(): CodeViewLineSelection | null;
  clearSelectedLines(o?: SelectionWriteOptions): void;
  subscribeToScroll(fn: (top: number, viewer: CodeView<T>) => void): () => void;
  getTopForItem(id: string): number | undefined;
  onThemeChange(): void;
  reset(): void;
  cleanUp(): void;
}

// vanilla render callbacks return DOM nodes, not framework elements
renderAnnotation?(a: DiffLineAnnotation<T>, ctx: ItemContext<T>): HTMLElement | undefined;
renderGutterUtility?(getHoveredRow: () => GetHoveredLineResult | undefined): HTMLElement | null;

// the comment-anchoring primitives
type AnnotationSide = 'deletions' | 'additions';
interface SelectedLineRange {
  start: number; end: number;
  side?: SelectionSide; endSide?: SelectionSide;   // default 'additions'
}
type DiffLineAnnotation<T> = { side: AnnotationSide; lineNumber: number }
                           & { metadata: T };      // required once T != undefined
interface CodeViewLineSelection { id: string; range: SelectedLineRange }
```

Consequences that drive the design:

1. **Catppuccin needs no `registerCustomTheme`.** All four flavors ship in Shiki
   4.3.1 as bundled themes (`catppuccin-latte|frappe|macchiato|mocha`), and
   `DiffsThemeNames` accepts any `BundledTheme`. Just pass the string.
2. **`CodeView` is imperative by nature.** `new CodeView(opts)` → `.setup(root)`
   → `.setItems()` / `.addItems()`. The server can stream file payloads in as
   they're computed; first paint doesn't wait for the whole diff. This is the
   *native* shape of the library — the React wrapper is a thin shim over this
   class, so going vanilla removes a layer rather than working against one.
3. **Mutating an item requires bumping `version`.** Intentional escape hatch;
   no deep equality. Every collapse toggle / annotation change must increment it.
   This is imperative-first by design and fits vanilla better than React.
4. **`parsePatchFiles` output has no `oldLines`/`newLines`**, so "expand
   unchanged" is dead unless we attach them manually. The docs explicitly bless
   doing so. → the server must ship full blob contents alongside the patch (§6).
5. **Shadow DOM + CSS custom properties.** All styling goes through
   `--diffs-*` vars; page CSS does not leak in. `unsafeCSS` exists but is
   explicitly not backwards-compatible — avoid.
6. **Virtualization estimates heights from `itemMetrics`.** Because we override
   the font and line-height for Victor Mono, `itemMetrics.lineHeight` and
   `diffHeaderHeight` **must** be re-measured or scroll positioning drifts.
   `__devOnlyValidateItemHeights: true` in dev catches this.
7. **The comment affordance is built in.** `enableGutterUtility: true` +
   `onGutterUtilityClick(range)` gives the GitHub-style `+` button in the line
   number column — click yields a single-line range, drag yields the released
   range. No custom `renderGutterUtility` needed (and the docs warn it interacts
   badly with `hunkSeparators: 'line-info'` on WebKit).
8. **Comment threads render as annotations.** `DiffLineAnnotation<T>` carries an
   arbitrary `metadata: T` payload and `renderAnnotation(ann, ctx)` draws it
   inline beneath the line — **returning an `HTMLElement`**, which is exactly
   what a vanilla component factory already produces. `lineNumber: 0` =
   file-level. `side` is `'additions' | 'deletions'`, stable across split and
   unified — so an anchor of `{side, lineNumber}` survives a view-mode toggle.
9. **Selection is viewer-wide** — one `{id, range}` across the whole
   `CodeView`, not per-file. So there is at most one *in-flight* composer;
   already-saved drafts must live as annotations, not as selection state.

Font: `@fontsource-variable/victor-mono@5.3.0` (variable, self-hostable woff2,
OFL-1.1). Cursive italics come free — Catppuccin's Shiki themes mark comments
italic, so the shadow-DOM `font-style: italic` picks up Victor Mono's cursive set.

---

## 3. Architecture

```
  argv  ──▶  revspec resolver ──▶  git plumbing ──▶  diff model
                                    (exec git)          │
                                                        ▼
   browser ◀── loopback HTTP ◀── embed.FS (SPA) + JSON API
      │
      └─ vanilla TS/ESM ▸ CodeView ▸ shadow DOM ▸ Shiki(catppuccin) ▸ worker pool
```

**No framework.** The vanilla entrypoint is the library's native API; React is a
peer dependency we simply never install. The runtime dependency list is
`@pierre/diffs` (+ its `shiki`) and the font — nothing else. TypeScript stays
(types only, erased at build); "no React" is not "no types".

**Shell out to `git`, do not use go-git.** Requirement 3 is "git-diff
semantics", and only git itself gets pathspec magic, `diff.*` config,
`.gitattributes` diff drivers, rename/copy detection, submodule and binary
handling exactly right. `git` is a hard runtime dependency; the *binary* is
still statically linked and self-contained.

Data flow, per request:

1. `git rev-parse --show-toplevel` → repo root, `--git-dir`, sanity check.
2. `git diff --raw -z --no-color --no-ext-diff <userargs>` → per-file status,
   modes, **blob SHAs**, old/new paths. This one call solves two problems:
   the file manifest *and* the handles needed to fetch full contents.
3. `git diff --patch -z ... -- <path>` per file (or one batch call) → unified patch text.
4. `git cat-file --batch` over the blob SHAs → full old/new contents for
   `oldLines`/`newLines`. Zero-SHA on the new side ⇒ read from worktree.

---

## 4. Repository layout

```
dv/
├── go.mod                      module github.com/alde/dv   (go 1.25)
├── main.go
├── internal/
│   ├── gitx/                   exec wrapper, revspec resolution, cat-file batch
│   │   ├── repo.go             Repo{root, gitdir}, Run/RunZ helpers
│   │   ├── revspec.go          argv → RevSpec (§5)
│   │   ├── raw.go              `--raw -z` parser
│   │   ├── patch.go            patch extraction
│   │   └── blob.go             `cat-file --batch` reader
│   ├── model/                  wire types shared by API (JSON tags)
│   ├── comments/               comments.json store (§8)
│   │   ├── schema.go           versioned on-disk types
│   │   ├── store.go            load/save, atomic write, mutex, ETag
│   │   ├── anchor.go           re-anchoring against a changed blob
│   │   ├── watch.go            fsnotify → SSE (agent writes land live)
│   │   └── export.go           md / prompt renderers
│   ├── server/                 mux, handlers, SSE/stream, embedded assets
│   │   └── assets.go           //go:embed all:../../web/dist
│   ├── openbrowser/            xdg-open / open / rundll32
│   └── config/                 flags + $XDG_CONFIG_HOME/dv/config.toml
├── web/
│   ├── package.json            bun; deps: @pierre/diffs, @fontsource-variable/victor-mono
│   ├── bun.lock                committed
│   ├── tsconfig.json           strict, no jsx
│   ├── vite.config.ts          worker.format:'es', manualChunks, outDir dist  (§9.1)
│   ├── index.html
│   ├── dist/.gitkeep           committed so `all:dist` embed never fails
│   └── src/
│       ├── main.ts             ~40 lines: wire modules together, nothing else
│       ├── core/
│       │   ├── store.ts        ~40-line observable store (subscribe/set/select)
│       │   ├── dom.ts          el()/frag()/on() helpers — the whole "framework"
│       │   ├── component.ts    Component contract: {el, update, destroy}
│       │   ├── bus.ts          typed pub/sub for cross-module events
│       │   └── router.ts       hash deep-links ⇄ state
│       ├── api/
│       │   ├── client.ts       typed fetch wrapper, token header, errors
│       │   ├── sse.ts          reconnecting EventSource
│       │   └── types.ts        mirrors Go internal/model (generated, §9)
│       ├── diff/
│       │   ├── viewer.ts       owns the CodeView instance + lifecycle
│       │   ├── items.ts        payload → CodeViewItem (attaches oldLines/newLines)
│       │   ├── options.ts      builds CodeViewOptions from app state
│       │   └── metrics.ts      measured itemMetrics per font/size
│       ├── comments/
│       │   ├── store.ts        client cache + optimistic updates + SSE
│       │   ├── composer.ts     range → draft → POST     (lazy-loaded)
│       │   ├── thread.ts       renderAnnotation body → HTMLElement
│       │   ├── inbox.ts        right-hand panel
│       │   └── anchors.ts      comment → DiffLineAnnotation<Thread>
│       ├── theme/
│       │   ├── catppuccin.ts   flavor → shiki name + chrome palette
│       │   ├── controller.ts   apply/persist/system-pref listener
│       │   └── theme.css       app-chrome vars from @catppuccin/palette
│       ├── ui/
│       │   ├── shell.ts        grid layout, panel show/hide
│       │   ├── file-tree.ts
│       │   ├── toolbar.ts
│       │   ├── status-bar.ts
│       │   ├── keybinds.ts
│       │   └── help.ts
│       └── styles/
│           ├── reset.css
│           ├── app.css
│           └── victor-mono.css
├── Makefile
└── plan.md
```

`go:generate` on `assets.go` runs the web build; `make build` does
`web` then `go build -trimpath -ldflags="-s -w"`.

---

## 5. git-diff semantics (requirement 3 — the core)

### 5.1 Supported grammar

```
dv [<dv-opts>] [<git-diff-opts>] [<commit>] [--] [<path>...]
dv ... <commit> <commit>   [--] [<path>...]
dv ... <commit>..<commit>  [--] [<path>...]
dv ... <commit>...<commit> [--] [<path>...]     # vs. merge base
dv ... --cached|--staged [<commit>] [--] [<path>...]
dv ... --merge-base <commit> <commit>
```

Default with no revision args: **worktree vs. index** — exactly `git diff`.

| Invocation | Meaning |
| --- | --- |
| `dv` | unstaged changes |
| `dv --staged` | index vs `HEAD` |
| `dv HEAD` | worktree vs `HEAD` (staged + unstaged) |
| `dv main feature` | two-dot, tree-to-tree |
| `dv main..feature` | identical to above (git treats `..` in `diff` as two-dot) |
| `dv main...feature` | vs. `git merge-base main feature` |
| `dv HEAD~3 -- src/` | pathspec-limited |
| `dv -- ':(exclude)*.lock'` | pathspec magic passes through untouched |

### 5.2 Argument resolution

Do **not** hand-roll git's rev/path disambiguation. Delegate:

1. If a literal `--` is present, split there. Done — left is revs+opts, right is pathspecs.
2. Otherwise walk leading non-flag args and probe each with
   `git rev-parse --verify --quiet <arg>^{commit}` (for range forms, split on
   `...`/`..` first and probe both sides). Stop at the first arg that isn't a
   commit-ish.
3. If an arg is *both* a valid rev and an existing path, reproduce git's error:
   `fatal: ambiguous argument '<x>': both revision and filename`, and tell the
   user to disambiguate with `--`.
4. Everything not consumed as a rev is a pathspec and is passed to git verbatim
   after a synthesized `--`.

The resolved `RevSpec` is retained (not just forwarded) because we need the two
sides' tree-ish names to fetch blobs for expansion and for the header UI.

### 5.3 Passthrough git-diff options (v1)

Accepted and forwarded: `-M/--find-renames`, `-C/--find-copies`,
`--find-renames=<n>`, `-w/--ignore-all-space`, `-b`, `--ignore-blank-lines`,
`--diff-filter=<f>`, `--no-renames`, `-R`, `--relative`, `--submodule=<fmt>`,
`-U<n>/--unified=<n>`.

dv-only flags use long names to avoid collision:
`--port`, `--host`, `--no-open`, `--theme <flavor|auto>`, `--view split|unified`,
`--wrap`, `--untracked`, `--max-blob <bytes>`, `--open-file <path>`.

### 5.4 Edge cases to handle explicitly

- **Untracked files** — invisible to `git diff`. With `--untracked`, list via
  `git ls-files --others --exclude-standard` and synthesize a `new file` diff.
- **Binary** — `--raw` gives the SHAs; detect via `git cat-file` + NUL sniff or
  `--numstat` reporting `-\t-`. Render a `file` item with a "Binary file
  (N bytes)" placeholder rather than crashing the parser.
- **Renames / copies** — `FileDiffMetadata.prevName` + `type: 'rename-pure' |
  'rename-changed'`; sidebar shows `old → new`.
- **Mode-only changes** — no hunks; render header-only item with the mode delta.
- **Symlinks & submodules** — mode `120000` / `160000`; render as one-line
  text diffs, don't try to read them as source.
- **No newline at EOF** — carried by `parsePatchFiles` as `noEOFCR*`; verify it
  survives our patch splitting.
- **CRLF / `core.autocrlf`** — always run git with `--no-ext-diff` and read
  blobs raw; never let a diff driver rewrite content.
- **Large files** — above `--max-blob` (default 2 MiB) ship the patch but omit
  `oldLines`/`newLines`, disabling expansion for that file. Surface it in the UI
  rather than silently degrading.
- **Empty diff** — friendly "no changes" state, exit code 0.
- **Not a repo** — mirror git's message, exit 128.

---

## 6. HTTP API contract

All under `/api`, JSON, loopback only, single-origin. A random per-run token in
a `Sec-Dv-Token` header guards mutating/expensive endpoints against drive-by
localhost requests from other pages.

```
GET  /api/session
     → { repoRoot, spec: {kind, left, right, mergeBase?}, argv, defaults:{theme,view} }

GET  /api/manifest
     → { files: [ { id, path, prevPath?, status, additions, deletions,
                    binary, tooLarge, mode:{old,new}, oldSha, newSha } ],
         totals: { files, additions, deletions } }

GET  /api/file/{id}
     → { id, path, prevPath?, status,
         patch:  string,          // unified diff for this single file
         oldLines: string[]|null, // null ⇒ expansion unavailable
         newLines: string[]|null,
         binary: boolean, tooLarge: boolean }

GET  /api/stream          (SSE)   // manifest first, then file payloads as ready
GET  /healthz

# comments — see §8
GET    /api/comments              → { doc, etag }
POST   /api/comments              → { anchor, body } → Comment  (server assigns id/anchor context)
PATCH  /api/comments/{id}         → { body?, status? }          (If-Match: etag)
DELETE /api/comments/{id}
POST   /api/comments/{id}/replies → { body } → Reply
GET    /api/comments/stream (SSE) → pushes on any change, incl. external file edits
```

Client contract: `manifest` paints the sidebar and seeds `CodeView` with the
first N items; the rest arrive over `/api/stream` and land via `handle.addItems()`.

---

## 7. Frontend design

### 7.0 Module conventions (no framework)

Everything below is plain ES modules + TypeScript. To keep that from decaying
into one big `main.ts`, three rules, enforced by review and by lint:

1. **One export surface per file, one concern per file.** `main.ts` is wiring
   only — construct modules, connect them, `start()`. No DOM building, no fetch,
   no business logic. Target ≤ 60 lines.
2. **Every UI module is a factory returning the same contract**, so composition
   is uniform and teardown is never ad hoc:
   ```ts
   export interface Component<P = void> {
     el: HTMLElement;
     update(props: P): void;
     destroy(): void;
   }
   export function createFileTree(deps: Deps): Component<FileTreeProps> { … }
   ```
3. **State flows through `core/store.ts`, not through imports between UI
   modules.** UI modules never import each other; they take dependencies as
   constructor args. `bus.ts` carries cross-cutting events (`comment:created`,
   `theme:changed`). This is what a framework would otherwise be doing, in ~80
   lines we own.

`core/dom.ts` is the entire view layer:

```ts
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, props?: Partial<HTMLElementTagNameMap[K]> & { class?: string; data?: Record<string,string> },
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] => { … };
```

No innerHTML for anything user- or repo-derived (comment bodies go through a
small Markdown renderer with escaping; code never touches our DOM layer at all —
it lives in the library's shadow DOM).

### 7.1 CodeView wiring

One long-lived `CodeView` instance owned by `diff/viewer.ts`. Streaming appends
are `addItems()` calls — O(1), no reconciliation, no vdom:

```ts
import { CodeView, parsePatchFiles, type CodeViewItem } from '@pierre/diffs';

export function createViewer(root: HTMLElement, store: Store, bus: Bus) {
  const viewer = new CodeView<Thread[]>(buildOptions(store.get()));
  viewer.setup(root);                       // root is height:100%; overflow:auto

  const offScroll = viewer.subscribeToScroll(top => store.set({ scrollTop: top }));
  const offState  = store.subscribe('view', () => viewer.setOptions(buildOptions(store.get())));

  return {
    el: root,
    append: (items: CodeViewItem<Thread[]>[]) => viewer.addItems(items),
    scrollToFile: (id: string) => viewer.scrollTo({ type: 'item', id, align: 'start' }),
    destroy() { offScroll(); offState(); viewer.cleanUp(); },
  };
}
```

`diff/options.ts` builds the options object from state:

```ts
export const buildOptions = (s: AppState): CodeViewOptions<Thread[]> => ({
  theme: themeFor(s.flavor),          // string | {light,dark}
  diffStyle: s.view,                  // 'split' | 'unified'
  stickyHeaders: true,
  expandUnchanged: true,
  enableLineSelection: true,
  enableGutterUtility: true,          // the comment "+" (§8.1)
  hunkSeparators: 'expandable',
  layout: { paddingTop: 12, paddingBottom: 48, gap: 12 },
  itemMetrics: measuredMetrics(),     // §7.4
  __devOnlyValidateItemHeights: import.meta.env.DEV,
  onGutterUtilityClick: range => bus.emit('comment:compose', range),
  onSelectedLinesChange: sel => router.writeHash(sel),
  renderAnnotation: (ann, ctx) => renderThread(ann.metadata, ctx),  // → HTMLElement
});
```

Note `setOptions()` — theme and split/unified toggles reconfigure the existing
instance in place; no teardown, no remount.

Payload → item (this is where requirement-3 fidelity meets the renderer):

```ts
const [{ files }] = parsePatchFiles(payload.patch, `dv:${payload.id}`);
const fileDiff = files[0];
if (payload.oldLines) fileDiff.oldLines = payload.oldLines;  // enables expansion
if (payload.newLines) fileDiff.newLines = payload.newLines;
return { type: 'diff', id: payload.id, fileDiff, version: 0 };
```

### 7.2 Chrome

- Left: file tree / flat list with status badges, +/- counts, filter box,
  comment-count pips per file.
- Top: revspec breadcrumb, split/unified toggle, wrap toggle, theme picker, counts.
- Right (toggleable): comment inbox — all threads, filter by open/resolved/stale,
  click to `scrollTo` the anchor.
- Deep links: `#<fileId>:L10-L24` ⇄ `CodeViewLineSelection`, both directions.
- Keys: `j/k` next/prev file, `]/[` next/prev hunk, `/` filter, `t` theme,
  `c` comment on selection, `n/p` next/prev comment, `?` help.

### 7.3 Themes (requirement 4)

- Code surface: pass the Shiki name straight through — no registration needed.
  - `auto` → `{ light: 'catppuccin-latte', dark: 'catppuccin-mocha' }`
  - explicit → `latte | frappe | macchiato | mocha`
- App chrome: generate CSS vars from `@catppuccin/palette` (base, mantle, crust,
  surface0-2, text, subtext0/1, overlay0-2, plus accents) so the sidebar and
  toolbar match the code pane. One `[data-flavor="…"]` block per flavor.
- Diff add/del/mod colors: override with Catppuccin green/red/blue via
  `--diffs-addition-color-override` / `--diffs-deletion-color-override` /
  `--diffs-modified-color-override` so gutters agree with the palette instead of
  the library defaults.
- Persist to `localStorage`; `--theme` on the CLI wins for that run.

### 7.4 Font (requirement 5)

```css
:root {
  --diffs-font-family: 'Victor Mono Variable', ui-monospace, monospace;
  --diffs-font-size: 13px;
  --diffs-line-height: 20px;      /* px, not unitless — metrics math depends on it */
  --diffs-tab-size: 4;
  --diffs-header-font-family: 'Victor Mono Variable', ui-monospace, monospace;
  --diffs-min-number-column-width: 4ch;
}
```

- Import `@fontsource-variable/victor-mono` (latin + latin-ext woff2), self-hosted
  through Vite so the binary has zero network dependencies.
- Ship the italic axis too — cursive comments are the reason to pick this font.
- **Then re-measure `itemMetrics`.** `lineHeight` must equal the computed row
  height at 13px/20px, and `diffHeaderHeight` the real header height. Do this
  once at boot with an offscreen probe element rather than hardcoding, so a user
  font-size override can't desync virtualization.

### 7.5 Worker pool

Vanilla path: `getOrCreateWorkerPoolSingleton(workerFactory)` from
`@pierre/diffs/worker`, passed into the `CodeView` constructor's second
argument. The Vite factory is:

```ts
const workerFactory = () =>
  new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' });
```

with `worker: { format: 'es' }` in `vite.config.ts` (the docs call this out, and
Vite is one of the two officially-tested bundlers). Set `cacheKey` on every
`FileDiffMetadata` (`dv:<id>:<oldSha>:<newSha>`) so AST caching actually hits —
the keys are content-addressed, which is exactly the invalidation rule the docs
require.

### 7.6 Code splitting (build output)

Not one `main.js`. Vite emits a chunk graph; we shape it deliberately:

- **Automatic**: Shiki lazy-imports each theme and grammar, so every Catppuccin
  flavor and every language lands in its own chunk and is fetched on demand.
  This is the single biggest win — bundling all of Shiki eagerly would be
  multiple MB.
- **Explicit dynamic imports** for things not needed at first paint:
  `comments/composer.ts`, `ui/help.ts`, the Markdown renderer, the worker.
- **`manualChunks`** to split `@pierre/diffs` core from app code so the library
  chunk stays cacheable across dv releases. This capability is a deciding factor
  in the bundler choice — see §9.1.
- Entry stays small: shell + toolbar + file tree paint before the diff payloads
  arrive.

Chunks are content-hashed, precompressed (gzip + br) at build time, and served
from `embed.FS` with immutable cache headers.

---

## 8. Line comments → `comments.json` (requirement 6)

The point of this feature is the **handoff**: a human reads the diff, marks up
line ranges, and the resulting file is a complete, self-contained work order an
agent can act on without access to the UI or the original selection state.

### 8.1 Interaction

1. `enableGutterUtility: true` puts a `+` in the line-number column on hover.
2. Click (one line) or drag (a range) → `onGutterUtilityClick(range)` fires on
   pointer-up with a `SelectedLineRange`. `enableLineSelection: true` +
   `onLineSelected` covers the keyboard/drag path and the `c` shortcut.
3. The composer opens pinned to the range's last line. Markdown, ⌘↵ to save.
4. On save the server resolves the anchor (§8.3), appends to `comments.json`,
   and echoes the stored `Comment`.
5. The client turns it into a `DiffLineAnnotation<Thread>` at
   `{ side, lineNumber: range.end, metadata: thread }`, pushes it onto the
   item's `annotations`, **increments `item.version`**, and calls
   `viewer.updateItem(item)`. `renderAnnotation(ann, ctx)` returns the thread
   card as an `HTMLElement` — built with `core/dom.ts`, same `Component`
   contract as every other UI module, no framework in the loop.

Because selection is viewer-wide, only one composer can be open at a time.
Unsaved draft text is kept in the store keyed by anchor so switching files and
back doesn't lose it.

Lifecycle caveat for the vanilla path: `renderAnnotation` is called by the
virtualizer as rows enter the render window and its output is discarded when
they leave. Thread components must therefore be **cheap to construct and free
of external subscriptions** — they read from the store at build time and are
re-created on `updateItem`, rather than subscribing and living forever. Any
listener they do attach is bound to the returned element so it dies with it.

### 8.2 Schema

```jsonc
{
  "version": 1,
  "generator": "dv/0.1.0",
  "repo":  { "root": "/home/alde/dev/alde/dv", "head": "a1b2c3d…" },
  "spec":  { "kind": "two-dot", "argv": ["main","feature"],
             "left": "9f8e…", "right": "1c2d…", "mergeBase": null },
  "updatedAt": "2026-07-26T18:04:11Z",
  "comments": [
    {
      "id": "cmt_01J8ZQ4K",
      "status": "open",                       // open | resolved | wontfix
      "author": { "name": "Alde Rojas", "email": "…" },  // from git config
      "createdAt": "…", "updatedAt": "…",
      "body": "This retries forever if the context is already cancelled.",
      "anchor": {
        "path": "internal/gitx/blob.go",
        "prevPath": null,
        "side": "additions",                  // additions ⇒ new file, deletions ⇒ old
        "startLine": 42, "endLine": 47,
        "blobSha": "e5f6…",                   // blob for that side, content identity
        "lang": "go",
        "quote": "\tfor {\n\t\tif err := r.next(); err != nil {\n…",
        "contextBefore": ["func (r *Reader) drain() error {"],
        "contextAfter":  ["}"]
      },
      "resolvedAnchor": { "stale": false, "movedFrom": null },
      "replies": [
        { "id": "rpl_…", "author": {"name":"agent"}, "createdAt": "…",
          "body": "Fixed in 3f1a — added a ctx.Err() check." }
      ]
    }
  ]
}
```

Design notes:

- **`quote` is load-bearing.** It is what makes the file useful standalone
  (an agent gets the code, not just coordinates) *and* it is the re-anchoring
  key when line numbers move. `contextBefore/After` (default 3 lines) give the
  agent orientation without a repo read.
- `side` + line numbers are the library's own coordinate space, so a comment
  round-trips through `DiffLineAnnotation` with no translation.
- `blobSha` is content-addressed → cheap exact-match validation.
- Ordering is stable: by path, then `startLine`, so diffs of `comments.json`
  itself stay readable.

### 8.3 Anchoring & staleness

The hard part. When the diff changes underneath a comment (rebase, new commit,
`--amend`, a plain edit in the worktree), resolve in this order:

1. `blobSha` still matches the current blob for that side → **exact**, use line
   numbers verbatim.
2. Otherwise search the current side's content for `quote`.
   Exactly one match → **re-anchor**, record `movedFrom: {startLine, endLine}`.
3. Zero or >1 matches → **`stale: true`**. Keep the comment and render it in the
   sidebar inbox under "unanchored" so a comment that goes stale mid-session is
   still in front of the reviewer.

Whitespace-insensitive fallback matching before declaring stale; log which rule
fired so the behaviour is debuggable.

**The startup clean.** Staleness is a live-session state, not something a file
should accumulate. The one-shot pass in `prepareComments` re-anchors and then
*drops* two kinds of comment, reporting the count on stderr:

1. Anything still `stale` after the resolve above.
2. Anything anchored to a file **the current diff does not touch**, matched
   against the manifest under both its path and its `prevPath`.

Rule 2 is the one that does the work when a file outlives its revspec. Such a
comment is not stale in the §8.3 sense at all — its blob is sitting in the tree
untouched, so it resolves *exactly* — but the diff has no row to hang it on, so
keeping it only clutters the inbox. Anchoring alone cannot see this: `SideContent`
reads any path in the tree, not just the ones in the diff.

The clean therefore runs after the manifest is built, and only there: the
per-request resolve behind `GET /api/comments` and the SSE push leave stale
comments alone, so a comment that goes stale mid-session stays visible.

### 8.4 Agent round-trip

`comments.json` is a **two-way** contract, which is why the schema separates
ownership:

| Field | Owner | Notes |
| --- | --- | --- |
| `id`, `anchor`, `createdAt`, `author` | dv | agents must not rewrite |
| `body` | human | |
| `status` | either | agent sets `resolved` when it lands a fix |
| `replies[]` | either | agent appends what it changed |

The server watches the file with fsnotify. An agent editing `comments.json` on
disk → SSE → the UI updates live, so a human sees replies and resolutions land
while the agent works. Writes are atomic (temp + rename) and guarded by an
ETag/`If-Match` so a UI write can't clobber a concurrent agent write; on
conflict the server returns 409 and the client re-reads.

CLI for the non-UI half of the loop:

```
dv comments list [--status open] [--path <glob>]
dv comments export --format md|json|prompt [-o -]
```

`--format prompt` emits a ready-to-paste block: the spec, then per comment the
file, line range, fenced `quote` with real line numbers, and the body — i.e.
`cat comments.json | agent` works, but `dv comments export --format prompt`
works better.

### 8.5 Decisions to confirm

- **Default location**: `<repo-root>/comments.json`, overridable with
  `--comments <path>`; `--no-comments` disables the feature. It is deliberately
  *not* auto-gitignored — dv prints a one-line hint on first write so the user
  chooses to commit it or ignore it.
- **Scoping**: one file per repo, containing the `spec` it was authored
  against. Re-running `dv` with a *different* revspec loads the same file and
  re-anchors (§8.3) rather than starting fresh — comments outliving a rebase is
  the whole point.

---

## 9. Build & embedding (requirement 2)

### 9.1 Toolchain: bun for install, Vite for the bundle

Benchmarked on this exact stack (`@pierre/diffs` + Shiki 4.3.1, vanilla TS, HTML
entry, CSS), not assumed:

| | Vite 7.3.6 | `bun build` 1.3.14 |
| --- | --- | --- |
| Prod build (cold) | **6.46 s** | **0.28 s** |
| Chunks emitted | 312 | 358 |
| Total output | 11 MB | 11 MB |
| HTML entry rewritten w/ hashed assets | ✅ | ✅ |
| CSS bundled + hashed | ✅ | ✅ |
| Shiki grammars auto-split per language | ✅ | ✅ |
| `new URL('@pierre/diffs/worker/worker.js', import.meta.url)` | ✅ (via `?worker&url`) | ❌ **left verbatim → 404 at runtime** |
| Worker as separate entrypoint | ✅ | ✅ (213 KB + 622 KB wasm chunk, 40 ms) |
| `manualChunks` / forced vendor split | ✅ | ❌ (`--splitting` is on/off only) |
| Tested by library authors | ✅ | ❌ |

**Decision: `bun install` + `vite build`.** The two halves go opposite ways for
different reasons:

- **Package manager → bun, no contest.** Cold install `0.24 s` vs pnpm `7.00 s`.
  Free, reversible, zero risk.
- **Bundler → Vite, despite losing the speed benchmark 23×.** Build time is the
  wrong thing to optimise here: the bundle is built once per `make build`, in a
  target that also compiles Go and cross-compiles a release matrix. Six seconds
  is noise, and the dev loop doesn't pay it at all (§9.2 proxies to the Vite dev
  server). What we'd actually be trading away is real:
  1. **Worker support.** Verified: bun leaves the bare specifier unresolved in
     the output. Workable via a second entrypoint, but Vite just does it.
  2. **`manualChunks`.** §7.6 depends on pinning `@pierre/diffs` into its own
     chunk so it stays cached across dv releases. bun offers no equivalent.
  3. **`@pierre/diffs` is at 1.2.12 and the docs say only Vite and Next.js are
     tested.** On a young dependency, being on the vendor-tested path means a
     breakage is their bug, not our bundler config.

Running Vite *under* the bun runtime was also measured — `6.78 s`, no better.
Rollup is the bottleneck, not the JS runtime, so there's nothing to reclaim there.

Revisit if web build time ever becomes a real constraint: `bun build` is a
verified-working fallback and the worker recipe for it is known
(`bun build ./src/main.ts ./node_modules/@pierre/diffs/dist/worker/worker.js
--outdir=dist --splitting`, then reference the worker at a fixed URL — our Go
server owns the URL space, so that's a one-line handler).

### 9.2 Targets

```make
web:            ; cd web && bun install --frozen-lockfile && bun run build   # build = vite build
build: web      ; CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/dv .
dev:            ; cd web && bun run dev &  go run . --dev-proxy http://localhost:5173
```

- `//go:embed all:dist` in `internal/server/assets.go`; `web/dist/.gitkeep` is
  committed so a clean checkout compiles before anyone runs a JS build (the
  `all:` prefix is required for dotfiles to match).
- `bun.lock` committed; `--frozen-lockfile` in CI.
- `CGO_ENABLED=0` ⇒ genuinely static; cross-compile matrix in CI, checksums on release.
- `--dev-proxy` reverse-proxies to the Vite dev server so the dev loop gets HMR
  and never pays the production build cost.
- Assets served with immutable cache headers (hashed filenames) + gzip/br
  precompressed at build time.
- Bun also covers the test runner and any build scripts — Vite's only job is the
  production bundle and the dev server.

---

## 10. Milestones

| # | Milestone | Done when |
| --- | --- | --- |
| 1 | Go skeleton + embed + server + browser open | `dv` serves a hello page from one binary |
| 2 | `gitx`: revspec resolution + `--raw` + patch + `cat-file` | golden tests for every §5.1 form pass |
| 3 | API §6 incl. SSE | `curl /api/manifest` correct on a real repo |
| 4 | Vite shell (`core/` + `ui/`) + vanilla `CodeView` rendering real diffs | round-trips a 200-file diff; `main.ts` still ≤ 60 lines |
| 5 | Expansion via `oldLines`/`newLines` | "expand unchanged" works on a patch-sourced diff |
| 6 | Catppuccin (code + chrome) + picker | all 4 flavors + auto, no FOUC |
| 7 | Victor Mono + measured `itemMetrics` | `__devOnlyValidateItemHeights` silent |
| 8 | Worker pool + `cacheKey` | 5k-line file scrolls without blanking |
| 9 | Edge cases §5.4 | each has a fixture repo test |
| 10 | Comments: gutter `+` → composer → `comments.json` → annotation | a comment survives a page reload and renders inline |
| 11 | Comment re-anchoring + stale handling (§8.3) | comment survives an amend that shifts its lines |
| 12 | Agent round-trip: fsnotify → SSE, `dv comments export` | external edit to the file appears in the UI without reload |
| 13 | Polish: keys, deep links, sidebar, inbox, empty/error states, `--help` | — |
| 14 | CI cross-compile + release | — |

### Testing

- **Go**: table tests over `gitx` using throwaway repos built by a fixture
  helper (`git init`, commit, mutate). One fixture per §5.4 edge case.
- **Contract**: golden JSON for `/api/manifest` and `/api/file/{id}`.
- **Comments**: unit tests for each §8.3 branch (exact / moved / ambiguous /
  gone), atomic-write and 409 concurrency tests, and a round-trip test that
  writes `comments.json` out-of-band and asserts the SSE push.
- **Web**: Vitest (jsdom) for the pure modules — `items.ts` (patch →
  `CodeViewItem`, expansion attach), `anchors.ts` (comment →
  `DiffLineAnnotation`, split ⇄ unified stability), `core/store.ts`,
  `core/dom.ts` escaping. Component factories are testable without a framework
  harness: call the factory, assert on `.el`, call `.destroy()`, assert
  listeners are gone.
- One Playwright smoke test — boot the binary, assert rendered lines, theme
  switch, expand-unchanged, and drag-select → comment → reload → still there.

---

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| `unsafeCSS` explicitly has no back-compat guarantee | Style only via `--diffs-*` vars; if unavoidable, isolate in one file and pin the version |
| `itemMetrics` desync from custom font ⇒ scroll jitter | Measure at runtime, keep `__devOnlyValidateItemHeights` on in dev |
| Forgetting `version++` on item mutation ⇒ stale render | Single `updateItem` helper that bumps it; never mutate items inline |
| Huge diffs (10k files) blow memory | Manifest-first + streamed payloads + `--max-blob`; cap eager items, load rest on demand |
| Reimplementing git's rev/path split subtly wrong | Delegate to `git rev-parse --verify`; fixture-test every §5.1 form |
| `@pierre/diffs` is young; API churn | Pin exact `1.2.12`, lockfile committed, upgrades are deliberate |
| **Comments silently lost when the diff moves** | Never delete on re-anchor failure — mark `stale`, surface in the inbox (§8.3) |
| **UI and agent write `comments.json` concurrently** | Atomic temp+rename, ETag/`If-Match`, 409 + re-read; fsnotify keeps the UI current |
| Agent rewrites server-owned fields and corrupts the doc | Validate on load against the §8.2 schema; quarantine to `comments.json.bak` and report rather than crash |
| `comments.json` accidentally committed (or accidentally not) | Explicit one-time hint on first write; no magic `.gitignore` edits |
| **No framework ⇒ ad-hoc DOM code sprawls into one file** | The three §7.0 rules: `main.ts` is wiring only (≤60 lines), one concern per module, state via `core/store.ts` — UI modules never import each other |
| No framework ⇒ manual listener/teardown leaks | Uniform `Component.destroy()` contract; annotation components own no external subscriptions (§8.1) |
| `renderAnnotation` output is recreated on every virtualization pass | Keep thread construction cheap; measure with `resizeDebugging` if scroll degrades |

---

## 12. Stretch (post-v1)

- `--output diff.html`: use `@pierre/diffs/ssr` preloaders to bake a
  self-contained page (needs a JS runtime at build time — likely a `dv export`
  subcommand that shells to an embedded QuickJS or just documents `node`).
  Note the hydration path differs: vanilla `File`/`FileDiff` accept
  `prerenderedHTML`, but `CodeViewItem` has no such field — a static export
  would render standalone `FileDiff` instances rather than one `CodeView`.
- Watch mode: re-run the diff on worktree change, push over SSE.
- `dv log` / commit picker; `dv show <commit>`.
- `dv comments apply` — hand `comments.json` to a configured agent CLI and
  stream its replies back into the file.
- Comment reactions/labels (`needs-change`, `nit`, `question`) so an agent can
  triage by severity.
- Register the real Catppuccin VS Code themes via `registerCustomTheme` if
  Shiki's bundled versions drift from upstream.

---

## 13. Open questions

1. Module path — `github.com/alde/dv` assumed; confirm.
2. `git` as a runtime dependency is accepted (recommended). Alternative is
   go-git, which cannot match requirement 3 faithfully.
3. Server lifetime: exit when the last browser tab disconnects (default), or
   stay resident? Proposal: idle-timeout after 30 min with no clients.
4. `comments.json` at repo root vs. `.dv/comments.json` — root is the more
   agent-discoverable default (proposed), but it does put an untracked file in
   everyone's `git status`.
5. Should `dv` refuse to start if `comments.json` was authored against a spec
   whose commits are no longer reachable (e.g. after a force-push)? Proposal:
   warn, load anyway, mark everything unverifiable as `stale`.
