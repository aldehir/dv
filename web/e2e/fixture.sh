#!/usr/bin/env bash
#
# Builds the repository the browser tests review.
#
# The suite used to point dv at dv's own HEAD~1, which made every assertion a
# hostage of whatever the last commit happened to be: a commit that only deleted
# lines left no additions to find, and a gutter row addressed by index moved
# underneath the next drag. This builds a repo whose last commit never changes,
# so the tests can name what they expect.
#
# The diff it produces (HEAD~1 against the worktree) covers what the suite
# needs: additions and deletions in the same file, several separated hunks with
# unchanged context between them to expand, a file per grammar shiki is asked
# to tokenize, a pure-addition and a pure-deletion file, a rename, and a lock
# file with no grammar at all.

set -euo pipefail

repo=${1:?usage: fixture.sh <path>}

export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=dv
export GIT_AUTHOR_EMAIL=dv@example.invalid
export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME
export GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL
export GIT_AUTHOR_DATE='2024-01-01T00:00:00+00:00'
export GIT_COMMITTER_DATE=$GIT_AUTHOR_DATE

# Bulk exists so the diff is taller than the viewport: the rail needs something
# to scroll and the virtualiser needs something to leave unrendered.
STEPS=44

# $1 is "before" or "after". The two differ in three places only, far enough
# apart to land as separate hunks with expandable context between them.
gen_viewer() {
  local when=$1 i
  cat <<'TS'
import { createDisposer } from './disposer';
import { renderRow } from './row';

export interface ViewerOptions {
  mount: HTMLElement;
  wrap: boolean;
  onSelect(line: number): void;
}

export interface Viewer {
  el: HTMLElement;
  update(lines: readonly string[]): void;
  destroy(): void;
}

TS

  if [[ $when == after ]]; then
    cat <<'TS'
/**
 * Rows are measured once and cached by index. Re-measuring on every frame cost
 * more than the scroll it was meant to smooth.
 */
export function createViewer(options: ViewerOptions): Viewer {
  const disposer = createDisposer();
  const el = document.createElement('div');
  const measured = new Map<number, number>();
  el.className = 'viewer';

  const heightOf = (index: number): number => {
    const cached = measured.get(index);
    if (cached !== undefined) return cached;
    const height = options.wrap ? measureWrapped(index) : LINE_HEIGHT;
    measured.set(index, height);
    return height;
  };
TS
  else
    cat <<'TS'
export function createViewer(options: ViewerOptions): Viewer {
  const disposer = createDisposer();
  const el = document.createElement('div');
  el.className = 'viewer';

  const heightOf = (index: number): number =>
    options.wrap ? measureWrapped(index) : LINE_HEIGHT;
TS
  fi

  cat <<'TS'

  const update = (lines: readonly string[]): void => {
    el.replaceChildren(...lines.map((line, index) => renderRow(line, index)));
  };

  disposer.add(() => el.replaceChildren());
  return { el, update, destroy: () => disposer.dispose() };
}

const LINE_HEIGHT = 20;

function measureWrapped(index: number): number {
  return LINE_HEIGHT * Math.max(1, Math.ceil(index / 80));
}

TS

  for ((i = 1; i <= STEPS; i++)); do
    if [[ $when == after && $i -eq 18 ]]; then
      cat <<TS
export function step$i(value: number): number {
  // Clamping here keeps a torn scroll offset from poisoning the cache.
  const scaled = Math.round(value * $i);
  return Math.max(0, Math.min(scaled, Number.MAX_SAFE_INTEGER));
}

TS
    elif [[ $when == after && $i -eq 33 ]]; then
      cat <<TS
export function step$i(value: number, offset = 0): number {
  return Math.round(value * $i) + offset;
}

TS
    else
      cat <<TS
export function step$i(value: number): number {
  return Math.round(value * $i);
}

TS
    fi
  done
}

gen_render_go() {
  local when=$1
  cat <<'GO'
package render

import (
	"fmt"
	"strings"
)

// Row is one printed line of the rendered diff.
type Row struct {
	Number int
	Text   string
	Kind   string
}

GO

  if [[ $when == after ]]; then
    cat <<'GO'
// Render writes rows into a builder. It pre-sizes the builder because the
// growth doubling showed up in profiles of large patches.
func Render(rows []Row) string {
	var b strings.Builder
	b.Grow(len(rows) * 40)
	for _, row := range rows {
		fmt.Fprintf(&b, "%6d %s %s\n", row.Number, marker(row.Kind), row.Text)
	}
	return b.String()
}

func marker(kind string) string {
	switch kind {
	case "addition":
		return "+"
	case "deletion":
		return "-"
	default:
		return " "
	}
}
GO
  else
    cat <<'GO'
// Render writes rows into a builder.
func Render(rows []Row) string {
	var b strings.Builder
	for _, row := range rows {
		fmt.Fprintf(&b, "%6d %s\n", row.Number, row.Text)
	}
	return b.String()
}
GO
  fi
}

gen_css() {
  local when=$1
  cat <<'CSS'
.viewer {
  display: grid;
  grid-template-columns: max-content 1fr;
  font-family: var(--dv-mono), monospace;
  font-size: 12px;
  line-height: 20px;
}

.viewer__gutter {
  padding-inline: 8px;
  color: var(--dv-overlay1);
  text-align: right;
  user-select: none;
}

CSS
  if [[ $when == after ]]; then
    cat <<'CSS'
.viewer__row {
  contain: content;
  white-space: pre;
}

.viewer__row--addition {
  background: color-mix(in oklab, var(--dv-green) 14%, transparent);
}

.viewer__row--deletion {
  background: color-mix(in oklab, var(--dv-red) 14%, transparent);
}
CSS
  else
    cat <<'CSS'
.viewer__row {
  white-space: pre;
}
CSS
  fi
}

gen_readme() {
  local when=$1
  cat <<'MD'
# fixture

A small repository the browser tests review. Nothing here is real; it exists so
the diff under `dv HEAD~1` is the same on every run.

## Layout

| Path | Holds |
|---|---|
| `src/viewer.ts` | the virtualised row list |
| `src/render.go` | the text renderer |
| `styles/app.css` | one stylesheet |

MD
  if [[ $when == after ]]; then
    cat <<'MD'
## Measuring

Row heights are cached by index. A wrapped row is measured once and reused
until the wrap setting changes.

## Rendering

The Go side pre-sizes its builder and prefixes each row with its marker.
MD
  else
    cat <<'MD'
## Rendering

The Go side walks the rows and prints each one.
MD
  fi
}

rm -rf "$repo"
mkdir -p "$repo"/{src,styles,docs}
cd "$repo"

git init -q -b main .

gen_viewer before >src/viewer.ts
gen_render_go before >src/render.go
gen_css before >styles/app.css
gen_readme before >README.md
printf 'shiki@1.0.0\n  resolved "https://example.invalid/shiki"\n  integrity sha512-%s\n' \
  "$(printf 'a%.0s' {1..64})" >vendor.lock
cat <<'TS' >src/legacy.ts
// Superseded by src/viewer.ts; kept until the last caller moved over.
export function legacyMeasure(rows: readonly string[]): number {
  return rows.reduce((total, row) => total + row.length, 0);
}

export function legacyRender(rows: readonly string[]): string {
  return rows.map((row, index) => `${index} ${row}`).join('\n');
}
TS
cat <<'MD' >docs/old-guide.md
# Guide

How to drive the viewer. Written against the first cut of the API.
MD

git add -A
git commit -q -m 'Seed the viewer'

# The commit under review: edits with both sides, a new file, a deletion, and a
# rename, so no single assertion depends on one file's shape.
gen_viewer after >src/viewer.ts
gen_render_go after >src/render.go
gen_css after >styles/app.css
gen_readme after >README.md
git mv -f docs/old-guide.md docs/guide.md
cat <<'MD' >docs/guide.md
# Guide

How to drive the viewer. Rewritten for the cached-height API.

Call `createViewer` once and hand it lines; it owns its own disposer.
MD
git rm -q src/legacy.ts
cat <<'TS' >src/new-feature.ts
import type { Viewer } from './viewer';

export interface Follower {
  follow(line: number): void;
  stop(): void;
}

/**
 * Keeps a marker on the selected line without re-rendering the list under it.
 */
export function followSelection(viewer: Viewer): Follower {
  let current = -1;

  return {
    follow(line: number): void {
      if (line === current) return;
      current = line;
      viewer.el.dataset.selected = String(line);
    },
    stop(): void {
      current = -1;
      delete viewer.el.dataset.selected;
    },
  };
}
TS
printf 'shiki@1.2.0\n  resolved "https://example.invalid/shiki"\n  integrity sha512-%s\n' \
  "$(printf 'b%.0s' {1..64})" >vendor.lock

git add -A
git commit -q -m 'Cache row heights and follow the selection'
