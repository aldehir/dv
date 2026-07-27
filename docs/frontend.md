# Frontend

`web/src` is a TypeScript SPA with **no framework**: no React, no JSX, no
reactive runtime. Plain DOM, a small store, an event bus, and factory functions.
TypeScript is strict, including `noUncheckedIndexedAccess` and
`verbatimModuleSyntax`.

## Module map

| Directory | What it owns |
|---|---|
| `core/` | the primitives: `dom`, `store`, `bus`, `component`, `router` |
| `api/` | `client` (fetch + token), `sse`, `loader`, and the mirrored `types` |
| `diff/` | the viewer, the hunk rail, item building, metrics, options, wheel |
| `comments/` | the comments store, anchor maths, thread cards, the inbox |
| `ui/` | shell, toolbar, file tree, controls, status bar, keybinds, help, icons |
| `theme/` | catppuccin flavors and the controller that applies them |
| `styles/` | reset, fonts, and `app.css` |

`main.ts` is the wiring and nothing else: build store/bus/client, compose the
shell, start the loader and the comments store, mount into `#app`.

## The component contract

`core/component.ts` defines it:

```ts
interface Component<P> {
  el: HTMLElement;
  update(props: P): void;
  destroy(): void;
}
```

Every UI module is a `createX(deps)` factory returning one. Two rules keep it
honest:

- **Subscriptions go through `createDisposer()`**, and `destroy` disposes it.
  Every `store.subscribe`, `bus.on`, and `on(target, …)` returns an unsubscribe;
  hand it to the disposer at the point you create it.
- **Props are derived from state by a pure function** next to the component —
  `shellProps(state)`, `controlsProps(state)`, `statusBarProps(state)`. That
  function is what the unit tests exercise.

Build DOM with the `el`/`frag`/`replaceChildren` helpers in `core/dom.ts`, not
`innerHTML`. `el` sets properties by assignment, with `class` and `data` as the
two special keys.

## Store and bus

Two different jobs, do not conflate them:

- **`core/store.ts`** holds `AppState` — session, manifest, theme, view, wrap,
  selection, filter, panel visibility, per-file load state. `set()` shallow-merges,
  compares with `Object.is`, and notifies only what changed. Subscribe to the
  whole state or to one key.
- **`core/bus.ts`** carries intents and one-shot events — `file:step`,
  `hunk:step`, `theme:cycle`, `comment:created`, `help:toggle`. `BusEvents` is
  the typed catalogue; add the key there first.

Rule of thumb: if a component needs to re-render when it changes, it is state;
if something *happened*, it is a bus event.

## Routing

The location hash is the only route: `#<fileId>` or `#<fileId>:L12-L20`, where
`fileId` is `base64url(path)`. `L` is the additions side, `D` the deletions
side, so a cross-side range reads `#<id>:D8-L14`. `parseHash`/`formatHash` in
`core/router.ts` are pure and unit-tested; the router writes with
`history.replaceState` so review navigation does not pile up back-button steps.

`dv --open-file <path>` works by appending that hash before opening the browser.

## Rendering the diff

`diff/viewer.ts` wraps `CodeView` from `@pierre/diffs`. dv supplies:

- items built by `diff/items.ts` from the patch text plus full old/new lines
  (that is what makes "expand unchanged" possible)
- options from `diff/options.ts` — theme, `split`/`unified`, wrap, layout
- annotations from `comments/anchors.ts` — threads and the live draft box
- metrics from `diff/metrics.ts`, measured off a real probe element so
  virtualisation predicts row heights correctly

Things to know before changing it:

- `CodeView` **virtualises**: only visible rows exist in the DOM.
- It renders into a **shadow root**. Chrome styles do not leak in; theme tokens
  are passed as options and `SCROLLBAR_CSS` is injected deliberately.
- `diff/rail.ts` draws every hunk down the right edge and *is* the scrollbar —
  drag, track press, wheel, and tick jumps all go through it.
- `diff/wheel.ts` exists for WebKit, which latches a wheel gesture to an element
  that cannot scroll on that axis and drops the delta. Do not "simplify" it away.

## Comments in the UI

`comments/store.ts` holds the document, subscribes to
`/api/comments/stream`, and applies optimistic pending entries (`dv-pending-*`
ids) until the server answers. `comments/anchors.ts` turns comments into
per-line annotations and owns the draft's position; `comments/thread.ts` renders
the cards; `comments/inbox.ts` is the side panel, split into anchored and
unanchored.

The draft box follows the current selection — selecting lines is the whole
affordance. `c` focuses it, `Esc` drops the selection but keeps the text.

## Theming

Catppuccin, four flavors, `auto` following `prefers-color-scheme`. The preference
persists to `localStorage` under `dv:theme`, and an inline script in
`index.html` applies `data-flavor` before first paint to avoid a flash.
`theme/theme.css` maps `--ctp-<flavor>-*` onto flat `--dv-*` tokens per
`[data-flavor]`, so components only ever reference `--dv-*`.

The code surface is themed separately, through the shiki theme name passed to
`CodeView` (`themeOptionFor`). Both have to move together — a browser test
asserts exactly that.

## Styles

One stylesheet, `styles/app.css`, BEM-ish: `.dv-block__element--modifier`. Class
names are also the browser tests' hooks, so renaming one means updating
`web/e2e/`. Sizing and color come from the `--dv-*` custom properties; avoid
hard-coded hex.

## Keybindings

Defined once in `ui/keybinds.ts` as `KEYBINDS`, which the help overlay renders —
add a binding there and the help updates itself.

| Key | Action |
|---|---|
| `j` / `k` | next / previous file |
| `]` / `[` | next / previous hunk |
| `/` | focus the file filter |
| `t` | cycle flavor |
| `c` | write in the comment box for the selection |
| `n` / `p` | next / previous comment |
| `g` | toggle the comment inbox |
| `b` | toggle the file tree |
| `?` | help |
| `Esc` | dismiss overlays |

Keys are ignored while a text entry has focus, except `Esc`, which blurs it.
