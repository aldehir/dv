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
| `diff/` | the viewer, the hunk rail, the hunk list and arrows, item building, metrics, options |
| `comments/` | the comments store, anchor maths, thread cards, the inbox |
| `ui/` | shell, toolbar, dock, file tree, controls, status bar, keybinds, help, fullscreen, icons, the narrow layout, the pointer kind |
| `theme/` | catppuccin flavors and the controller that applies them |
| `styles/` | reset, fonts, and `app.css` |

`main.ts` is the wiring and nothing else: build store/bus/client, compose the
shell, start the loader and the comments store, mount into `#app`.

## The chrome

`ui/shell.ts` owns one grid: toolbar across the top, status across the bottom,
and between them the file tree, the diff, the panel, and the dock — the thin
strip of buttons down the far right edge.

The panel holds both of its lists at once, the hunk list and the comment inbox,
and `panelView` picks which one is on show; the other is hidden in CSS rather
than torn down, so neither loses its place. Every way in goes through one bus
event, `panel:toggle`, carrying the list it wants: pressing the button of the
list already showing closes the panel instead.

## Narrow windows

`ui/compact.ts` watches one media query, `(max-width: 48rem)`, and writes
`compact` into the store; the shell mirrors it onto `data-compact`, which is the
only hook the stylesheet needs. Crossing into it switches the diff to unified
and folds the file tree away, remembering what it displaced so growing the
window puts it back — including the server's `view` default, which lands after
the first paint. Neither is forced: a choice made while narrow stands until the
window crosses the line again.

The tree and the panel do not shrink to fit, they stop taking a column of their
own and stand in the diff's grid area instead, so they slide over it. The diff
keeps its full width either way.

Nothing else keeps a column down the right edge either. The dock lies down at
the end of the status bar, where a thumb can reach it, and the rail hides — a
hairline of ticks is no touch target, and the width is better spent on code.
`diff/hunk-nav.ts` stands in for it: the pair of arrows floated over the bottom
right corner, walking the same `hunk:step` as `[` and `]`.

## Touch

A different axis from narrow, so a different flag: `ui/pointer.ts` watches
`(pointer: coarse)` and writes `coarse` into the store. A phone is both, a
laptop with a dragged-in window is only compact, a tablet in landscape is only
coarse.

- `button` is `touch-action: manipulation` in the reset, so a quick second tap
  on the hunk arrows is another press rather than a zoom.
- A drag across the code is the diff scrolling, which leaves a thumb with no
  way to reach a range, so `coarse` turns the library's gutter plus back on —
  the button `8ad0be5` took away when selecting lines became the whole
  affordance, and the one place that still needs it.
  Tap a line, then drag its handle to the other end. The viewer drops
  `composing` on a press that lands on the handle: the draft card hangs under
  the line the handle belongs to, and the library reads any point inside an
  annotation as that same line, so leaving the card there costs the drag its
  first hundred pixels downward.

## Fullscreen

`ui/fullscreen.ts` owns both halves of it. `fullscreen` in the store folds the
toolbar and the status bar away, which is all that iOS Safari on a phone can
have; where the browser does support element fullscreen it is asked for too, and
followed back out, so leaving through the browser's own gesture puts the chrome
back. The floating button is the way out: fullscreen hides the toolbar the
toggle lives in, and a phone has no `f` to press.

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
  are passed as options and `SHADOW_CSS` is injected deliberately.
- `diff/rail.ts` draws every hunk down the right edge and *is* the scrollbar —
  drag, track press, wheel, and tick jumps all go through it.
- `diff/hunks.ts` is the same hunks read out as a list, grouped by file, with
  the one the top of the view sits in marked. Both it and the rail work off
  `viewer.hunks()`, so a file that has not streamed in yet is in neither.
- `stepHunk` walks the whole diff, not one file: running off either end of the
  selected file carries on into the next loaded file that has hunks, and selects
  it.
- Files stream in whatever order the server's workers finish them. The viewer
  holds a payload until everything ranked ahead of it has landed or failed, and
  only ever appends; it never hands `CodeView` a reordered list. The library's
  rebuild keeps its render range by position, so a file drawn near the top and
  then pushed down by an insertion above it kept its element, and that stray
  element skewed the sticky window every scroll ran through.
- One file at a time (`singleFile`, `s`) keeps every payload in the viewer's
  own list but hands `CodeView` only the selected one. Changing the selection
  or the flag resets the view and appends afresh rather than reconciling, for
  the same reason. The rail and the hunk list then cover just that file, and
  `stepHunk` running off its end swaps the next one in.

## Remembered settings

`ui/prefs.ts` saves View, Wrap and Files to `localStorage` (`dv:view`,
`dv:wrap`, `dv:single-file`) and restores them before the compact layout and
the viewer are built, so the first draw is already the one the reader left. A
view a narrow window forced is not saved over the reader's own.

The session's `defaults` carry only what was asked for by flag or
`config.toml` — `view: ""` and `wrap: null` otherwise, as `theme: ""` always
has — and the loader applies just those, so `--view` or `--wrap` outranks the
remembered setting for that run without overwriting it.

## Comments in the UI

`comments/store.ts` holds the document, subscribes to
`/api/comments/stream`, and applies optimistic pending entries (`dv-pending-*`
ids) until the server answers. `comments/anchors.ts` turns comments into
per-line annotations and owns the draft's position; `comments/thread.ts` renders
the cards; `comments/inbox.ts` is the side panel, split into anchored and
unanchored.

The draft box follows the current selection — selecting lines is the whole
affordance, with the gutter plus standing in for the drag where the pointer is
a thumb (see [Touch](#touch)). `c` focuses it, `Esc` drops the selection but
keeps the text.

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
| `h` | toggle the hunk list |
| `s` | toggle one file at a time |
| `b` | toggle the file tree |
| `f` | toggle fullscreen |
| `?` | help |
| `Esc` | dismiss overlays |

Keys are ignored while a text entry has focus, except `Esc`, which blurs it.
