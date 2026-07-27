package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"strings"

	"github.com/alde/dv/internal/comments"
	"github.com/alde/dv/internal/gitx"
	"github.com/alde/dv/internal/model"
)

const commentsUsage = `Usage:
  dv comments list   [--status open|resolved|wontfix] [--path <glob>] [--comments <file>]
  dv comments export [--format md|json|prompt] [-o <file>|-] [--comments <file>]

Both read <repo-root>/comments.json (or --comments <file>) and never start a
server or a browser.
`

func Comments(argv []string, version string, stdout, stderr io.Writer) int {
	if len(argv) == 0 {
		fmt.Fprint(stderr, commentsUsage)
		return 2
	}
	switch argv[0] {
	case "list":
		return listComments(argv[1:], stdout, stderr)
	case "export":
		return exportComments(argv[1:], version, stdout, stderr)
	case "-h", "--help", "help":
		fmt.Fprint(stdout, commentsUsage)
		return 0
	default:
		fmt.Fprintf(stderr, "dv comments: unknown subcommand %q\n%s", argv[0], commentsUsage)
		return 2
	}
}

func listComments(argv []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("dv comments list", flag.ContinueOnError)
	flags.SetOutput(stderr)
	status := flags.String("status", "", "only comments with this status: open, resolved or wontfix")
	glob := flags.String("path", "", "only comments whose file matches this glob or prefix")
	file := flags.String("comments", "", "comments file to read")
	if err := flags.Parse(argv); err != nil {
		return 2
	}
	if *status != "" && !validStatus(*status) {
		fmt.Fprintf(stderr, "dv comments: invalid --status %q: want open, resolved or wontfix\n", *status)
		return 2
	}

	doc, code := load(*file, stderr)
	if doc == nil {
		return code
	}

	shown := 0
	for _, c := range doc.Comments {
		if *status != "" && string(c.Status) != *status {
			continue
		}
		if !matchesPath(*glob, c.Anchor.Path) {
			continue
		}
		writeComment(stdout, c)
		shown++
	}
	if shown == 0 {
		fmt.Fprintln(stdout, "no matching comments")
		return 0
	}
	fmt.Fprintf(stdout, "%d of %d comments\n", shown, len(doc.Comments))
	return 0
}

func writeComment(w io.Writer, c model.Comment) {
	fmt.Fprintf(w, "%s  [%s]  %s\n", anchorLabel(c.Anchor), c.Status, c.ID)
	fmt.Fprintf(w, "    %s  %s\n", author(c.Author), c.UpdatedAt)
	if c.ResolvedAnchor != nil {
		switch {
		case c.ResolvedAnchor.Stale:
			fmt.Fprintf(w, "    stale anchor (%s): find the code by its quoted lines\n", rule(c.ResolvedAnchor.Rule))
		case c.ResolvedAnchor.MovedFrom != nil:
			fmt.Fprintf(w, "    moved from lines %d-%d\n", c.ResolvedAnchor.MovedFrom.StartLine, c.ResolvedAnchor.MovedFrom.EndLine)
		}
	}
	for line := range strings.SplitSeq(strings.TrimRight(c.Body, "\n"), "\n") {
		fmt.Fprintf(w, "    %s\n", line)
	}
	for _, reply := range c.Replies {
		fmt.Fprintf(w, "    reply %s: %s\n", reply.Author.Name, oneLine(reply.Body))
	}
	fmt.Fprintln(w)
}

func exportComments(argv []string, version string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("dv comments export", flag.ContinueOnError)
	flags.SetOutput(stderr)
	format := flags.String("format", "md", "output format: md, json or prompt")
	out := flags.String("o", "-", "write here instead of stdout")
	flags.StringVar(out, "output", "-", "write here instead of stdout")
	file := flags.String("comments", "", "comments file to read")
	if err := flags.Parse(argv); err != nil {
		return 2
	}
	render, err := renderer(*format)
	if err != nil {
		fmt.Fprintf(stderr, "dv comments: %v\n", err)
		return 2
	}

	doc, code := load(*file, stderr)
	if doc == nil {
		return code
	}
	if doc.Generator == "" {
		doc.Generator = "dv/" + version
	}

	sink := stdout
	if *out != "-" && *out != "" {
		f, err := os.Create(*out)
		if err != nil {
			fmt.Fprintf(stderr, "dv comments: %v\n", err)
			return 1
		}
		defer f.Close()
		sink = f
	}
	if err := render(doc, sink); err != nil {
		fmt.Fprintf(stderr, "dv comments: %v\n", err)
		return 1
	}
	return 0
}

type renderFunc func(*model.CommentsDoc, io.Writer) error

func renderer(format string) (renderFunc, error) {
	switch format {
	case "md", "markdown":
		return comments.ExportMarkdown, nil
	case "json":
		return comments.ExportJSON, nil
	case "prompt":
		return comments.ExportPrompt, nil
	default:
		return nil, fmt.Errorf("invalid --format %q: want md, json or prompt", format)
	}
}

func load(file string, stderr io.Writer) (*model.CommentsDoc, int) {
	store, code := open(file, stderr)
	if store == nil {
		return nil, code
	}
	if !store.Exists() {
		fmt.Fprintf(stderr, "dv comments: %s does not exist yet\n", store.Path())
		return nil, 1
	}
	doc, _, err := store.Load()
	if err != nil {
		fmt.Fprintf(stderr, "dv comments: %v\n", err)
		return nil, 1
	}
	report := store.Report()
	if report.Quarantined() {
		fmt.Fprintf(stderr, "dv comments: the file was unreadable, moved it to %s\n", report.QuarantinePath)
		return nil, 1
	}
	for _, issue := range report.Issues {
		fmt.Fprintf(stderr, "dv comments: %s\n", issue)
	}
	return doc, 0
}

func open(file string, stderr io.Writer) (*comments.Store, int) {
	cfg := comments.Config{Path: file, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if file == "" {
		repo, err := gitx.Open("")
		if err != nil {
			var fatal *gitx.FatalError
			if errors.As(err, &fatal) {
				fmt.Fprintln(stderr, fatal.Message)
				return nil, fatal.ExitCode
			}
			fmt.Fprintf(stderr, "dv comments: %v\n", err)
			return nil, 1
		}
		cfg.Repo = model.RepoRef{Root: repo.Root}
	}
	store, err := comments.New(cfg)
	if err != nil {
		fmt.Fprintf(stderr, "dv comments: %v\n", err)
		return nil, 1
	}
	return store, 0
}

func validStatus(s string) bool {
	switch model.CommentStatus(s) {
	case model.CommentOpen, model.CommentResolved, model.CommentWontFix:
		return true
	}
	return false
}

func matchesPath(glob, filePath string) bool {
	if glob == "" {
		return true
	}
	if ok, err := path.Match(glob, filePath); err == nil && ok {
		return true
	}
	if ok, err := path.Match(glob, path.Base(filePath)); err == nil && ok {
		return true
	}
	prefix := strings.TrimSuffix(strings.TrimSuffix(glob, "**"), "*")
	if strings.ContainsAny(prefix, "*?[") {
		return false
	}
	return strings.HasPrefix(filePath, prefix)
}

func anchorLabel(a model.Anchor) string {
	switch {
	case a.StartLine == 0:
		return a.Path + " (whole file)"
	case a.EndLine > a.StartLine:
		return fmt.Sprintf("%s:%d-%d", a.Path, a.StartLine, a.EndLine)
	default:
		return fmt.Sprintf("%s:%d", a.Path, a.StartLine)
	}
}

func author(a model.Author) string {
	if a.Email == "" {
		return a.Name
	}
	return fmt.Sprintf("%s <%s>", a.Name, a.Email)
}

func rule(name string) string {
	if name == "" {
		return "unknown"
	}
	return name
}

func oneLine(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.Join(strings.Split(strings.TrimSpace(s), "\n"), " ")
}
