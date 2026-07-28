package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/alde/dv/internal/cli"
	"github.com/alde/dv/internal/comments"
	"github.com/alde/dv/internal/config"
	"github.com/alde/dv/internal/gitx"
	"github.com/alde/dv/internal/model"
	"github.com/alde/dv/internal/openbrowser"
	"github.com/alde/dv/internal/server"
)

//go:embed all:web/dist
var embeddedAssets embed.FS

var version = "dev"

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(argv []string) int {
	if len(argv) > 0 && argv[0] == "comments" {
		return cli.Comments(argv[1:], version, os.Stdout, os.Stderr)
	}

	base, err := config.LoadFile(config.ConfigPath())
	if err != nil {
		fmt.Fprintf(os.Stderr, "dv: %v\n", err)
		return 2
	}
	cfg, rest, err := config.Parse(base, argv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "dv: %v\nTry 'dv --help'.\n", err)
		return 2
	}
	switch {
	case cfg.Help:
		printUsage(os.Stdout)
		return 0
	case cfg.Version:
		fmt.Fprintf(os.Stdout, "dv %s\n", version)
		return 0
	}

	log := newLogger()
	repo, err := gitx.Open("")
	if err != nil {
		return reportFatal(err)
	}
	if rest == nil {
		rest = []string{}
	}
	spec, err := gitx.ResolveSpec(repo, rest)
	if err != nil {
		return reportFatal(err)
	}

	store, err := openStore(cfg, repo, spec, log)
	if err != nil {
		return reportFatal(err)
	}

	token, err := token()
	if err != nil {
		return reportFatal(err)
	}
	assets, err := fs.Sub(embeddedAssets, "web/dist")
	if err != nil {
		return reportFatal(err)
	}

	srv, err := server.New(server.Options{
		Repo:        repo,
		Spec:        spec,
		Git:         gitx.Options{MaxBlob: cfg.MaxBlob, Untracked: cfg.Untracked},
		Store:       store,
		Assets:      assets,
		Defaults:    defaults(cfg, base, argv),
		Token:       token,
		Host:        cfg.Host,
		Port:        cfg.Port,
		DevProxy:    cfg.DevProxy,
		IdleTimeout: cfg.IdleTimeout,
		Version:     version,
		Logger:      log,
	})
	if err != nil {
		return reportFatal(err)
	}

	manifest, err := srv.Manifest()
	if err != nil {
		return reportFatal(err)
	}
	fmt.Fprintf(os.Stderr, "dv: %s\n", summarize(manifest))

	// After the manifest: the clean drops comments this diff has no row for.
	if store != nil {
		prepareComments(repo, spec, store, manifest, log)
	}

	url, err := srv.Listen()
	if err != nil {
		return reportFatal(err)
	}
	fmt.Fprintf(os.Stderr, "dv: listening on %s\n", url)
	fmt.Fprintf(os.Stderr, "dv: token %s\n", token)

	if !cfg.NoOpen {
		openBrowser(url, cfg.OpenFile)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := srv.Serve(ctx); err != nil {
		return reportFatal(err)
	}
	return 0
}

func newLogger() *slog.Logger {
	level := slog.LevelWarn
	if value := os.Getenv("DV_LOG"); value != "" {
		if err := level.UnmarshalText([]byte(value)); err != nil {
			fmt.Fprintf(os.Stderr, "dv: ignoring DV_LOG=%q\n", value)
		}
	}
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
}

func token() (string, error) {
	if value := strings.TrimSpace(os.Getenv("DV_TOKEN")); value != "" {
		return value, nil
	}
	return server.NewToken()
}

func openStore(cfg config.Config, repo *gitx.Repo, spec *gitx.RevSpec, log *slog.Logger) (*comments.Store, error) {
	if cfg.NoComments {
		return nil, nil
	}
	head, err := repo.Head()
	if err != nil {
		return nil, err
	}
	return comments.New(comments.Config{
		Path:      cfg.Comments,
		Repo:      model.RepoRef{Root: repo.Root, Head: head},
		Spec:      spec.Model(),
		Generator: "dv/" + version,
		Logger:    log,
		OnFirstWrite: func(path string) {
			fmt.Fprintf(os.Stderr, "dv: created %s — commit it to share this review, or add it to .gitignore to keep it local\n", path)
		},
	})
}

func prepareComments(repo *gitx.Repo, spec *gitx.RevSpec, store *comments.Store, manifest *model.Manifest, log *slog.Logger) {
	if !store.Exists() {
		return
	}
	doc, _, err := store.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "dv: cannot read %s: %v\n", store.Path(), err)
		return
	}
	if report := store.Report(); report.Quarantined() {
		fmt.Fprintf(os.Stderr, "dv: %s was unreadable, moved it to %s and started a fresh one\n", store.Path(), report.QuarantinePath)
	}
	if missing := unreachableRevs(repo, doc.Spec); len(missing) > 0 {
		fmt.Fprintf(os.Stderr, "dv: %s was written against %s, which this repo no longer has — loading it anyway, comments that no longer match will be dropped\n",
			store.Path(), strings.Join(missing, " and "))
	}
	dropped, _, err := server.Reanchor(store, server.NewContentResolver(repo, spec), manifest, log)
	if err != nil {
		fmt.Fprintf(os.Stderr, "dv: cannot re-anchor the comments in %s: %v\n", store.Path(), err)
	}
	if n := len(dropped); n > 0 {
		noun := "comments"
		if n == 1 {
			noun = "comment"
		}
		fmt.Fprintf(os.Stderr, "dv: dropped %d %s from %s that this diff does not cover\n", n, noun, store.Path())
	}
}

func unreachableRevs(repo *gitx.Repo, spec model.Spec) []string {
	var missing []string
	for _, rev := range []string{spec.Left, spec.Right, spec.MergeBase} {
		if rev == "" {
			continue
		}
		if _, err := gitx.ResolveSpec(repo, []string{rev}); err != nil {
			missing = append(missing, short(rev))
		}
	}
	return missing
}

func short(rev string) string {
	if len(rev) > 12 {
		return rev[:12]
	}
	return rev
}

func defaults(cfg, base config.Config, argv []string) model.Defaults {
	d := model.Defaults{View: cfg.View, Wrap: cfg.Wrap}
	if themeRequested(base, argv) {
		d.Theme = cfg.Theme
	}
	return d
}

func themeRequested(base config.Config, argv []string) bool {
	if base.Theme != config.DefaultTheme {
		return true
	}
	for _, arg := range argv {
		if arg == "--" {
			return false
		}
		if arg == "--theme" || strings.HasPrefix(arg, "--theme=") {
			return true
		}
	}
	return false
}

func summarize(m *model.Manifest) string {
	if m.Totals.Files == 0 {
		return "no changes"
	}
	files := "files"
	if m.Totals.Files == 1 {
		files = "file"
	}
	return fmt.Sprintf("%d %s changed, %d insertions(+), %d deletions(-)",
		m.Totals.Files, files, m.Totals.Additions, m.Totals.Deletions)
}

func openBrowser(url, openFile string) {
	target := url
	if openFile != "" {
		target += "#" + gitx.FileID(openFile)
	}
	if err := openbrowser.Open(target); err != nil {
		fmt.Fprintf(os.Stderr, "dv: cannot open a browser (%v), visit %s yourself\n", err, target)
	}
}

const usage = `dv — read a git diff in your browser

Usage:
  dv [<dv-opts>] [<git-diff-opts>] [<commit>] [--] [<path>...]
  dv [<opts>] <commit> <commit>      [--] [<path>...]
  dv [<opts>] <commit>..<commit>     [--] [<path>...]
  dv [<opts>] <commit>...<commit>    [--] [<path>...]   vs. the merge base
  dv [<opts>] --cached|--staged [<commit>] [--] [<path>...]
  dv [<opts>] --merge-base <commit> <commit>
  dv comments list   [--path <glob>] [--comments <file>]
  dv comments export [--format md|json|prompt] [-o <file>|-] [--comments <file>]

With no revision, dv shows the same diff as plain 'git diff': the worktree
against the index. Revisions and pathspecs are resolved by git itself, so
pathspec magic such as ':(exclude)*.lock' works untouched. Use '--' when an
argument is both a revision and a filename.

Examples:
  dv                          unstaged changes
  dv --staged                 the index against HEAD
  dv HEAD                     the worktree against HEAD
  dv main feature             two-dot, tree against tree
  dv main...feature           against 'git merge-base main feature'
  dv HEAD~3 -- src/           limited to a pathspec
  dv -- ':(exclude)*.lock'    pathspec magic

dv options:
  --port <n>            listen on this port (default 8765; falls back to a free
                        one if it is taken)
  --host <addr>         address to bind: a loopback address, or 0.0.0.0 (::) to
                        expose dv on every interface (default 127.0.0.1)
  --no-open             do not launch a browser
  --theme <flavor>      auto|latte|frappe|macchiato|mocha (default auto)
  --view split|unified  initial diff layout (default split)
  --wrap                soft-wrap long lines
  --untracked           include untracked files as new files
  --max-blob <size>     skip full contents above this size, disabling
                        "expand unchanged" for that file (default 2MiB)
  --open-file <path>    scroll to this file on load
  --comments <file>     comments file (default <repo-root>/comments.json)
  --no-comments         disable comments entirely
  --idle-timeout <dur>  quit after this long with no connected client
                        (default 30m; 0 stays resident)
  --dev-proxy <url>     serve the UI from a Vite dev server instead of the
                        embedded assets
  --help, -h            this text
  --version             print the version

Forwarded to git diff:
  -M, --find-renames[=<n>], -C, --find-copies[=<n>], --no-renames,
  -w, --ignore-all-space, -b, --ignore-blank-lines, --diff-filter=<f>,
  -R, --relative, --submodule=<fmt>, -U<n>, --unified=<n>

Environment:
  DV_TOKEN   use this API token instead of a random per-run one
  DV_LOG     log level: debug|info|warn|error (default warn)

Configuration file (flags win):
  %s
`

func printUsage(w *os.File) {
	fmt.Fprintf(w, usage, configPathLabel())
}

func configPathLabel() string {
	path := config.ConfigPath()
	if path == "" {
		return "(no config directory)"
	}
	return path
}

func reportFatal(err error) int {
	var fatal *gitx.FatalError
	if errors.As(err, &fatal) {
		fmt.Fprintln(os.Stderr, fatal.Message)
		return fatal.ExitCode
	}
	fmt.Fprintf(os.Stderr, "dv: %v\n", err)
	return 1
}
