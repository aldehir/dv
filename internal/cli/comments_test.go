package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alde/dv/internal/model"
)

func seedFile(t *testing.T) string {
	t.Helper()
	doc := model.CommentsDoc{
		Version:   model.SchemaVersion,
		Generator: "dv/test",
		Repo:      model.RepoRef{Root: "/tmp/repo", Head: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		Spec:      model.Spec{Kind: model.SpecTwoDot, Left: "main", Right: "feature", Argv: []string{"main", "feature"}},
		UpdatedAt: "2026-07-26T18:04:11Z",
		Comments: []model.Comment{
			{
				ID: "cmt_open", Status: model.CommentOpen,
				Author: model.Author{Name: "Alde", Email: "alde@example.com"},
				Body:   "retries forever",
				Anchor: model.Anchor{
					Path: "internal/gitx/blob.go", Side: model.SideAdditions,
					StartLine: 42, EndLine: 44, Quote: "for {\n\tnext()\n}",
					ContextBefore: []string{}, ContextAfter: []string{},
				},
				ResolvedAnchor: &model.ResolvedAnchor{Stale: true, Rule: "gone"},
				Replies:        []model.Reply{{ID: "rpl_1", Author: model.Author{Name: "agent"}, Body: "fixed\nin 3f1a"}},
			},
			{
				ID: "cmt_done", Status: model.CommentResolved,
				Author: model.Author{Name: "Alde"},
				Body:   "nit: naming",
				Anchor: model.Anchor{
					Path: "web/src/main.ts", Side: model.SideAdditions, StartLine: 7, EndLine: 7,
					Quote: "const x = 1", ContextBefore: []string{}, ContextAfter: []string{},
				},
				Replies: []model.Reply{},
			},
		},
	}
	raw, err := json.MarshalIndent(&doc, "", "  ")
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	path := filepath.Join(t.TempDir(), "comments.json")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	return path
}

func run(t *testing.T, argv ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr strings.Builder
	code := Comments(argv, "test", &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func TestListFilters(t *testing.T) {
	path := seedFile(t)
	cases := []struct {
		name    string
		argv    []string
		want    []string
		notWant []string
	}{
		{
			name: "everything",
			argv: []string{"list", "--comments", path},
			want: []string{"internal/gitx/blob.go:42-44", "[open]", "web/src/main.ts:7", "2 of 2 comments"},
		},
		{
			name:    "by status",
			argv:    []string{"list", "--comments", path, "--status", "resolved"},
			want:    []string{"web/src/main.ts:7", "1 of 2 comments"},
			notWant: []string{"internal/gitx/blob.go"},
		},
		{
			name:    "by glob",
			argv:    []string{"list", "--comments", path, "--path", "internal/**"},
			want:    []string{"internal/gitx/blob.go"},
			notWant: []string{"web/src/main.ts"},
		},
		{
			name:    "by prefix",
			argv:    []string{"list", "--comments", path, "--path", "web/"},
			want:    []string{"web/src/main.ts"},
			notWant: []string{"internal/gitx/blob.go"},
		},
		{
			name: "no match",
			argv: []string{"list", "--comments", path, "--path", "nowhere/"},
			want: []string{"no matching comments"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, stdout, stderr := run(t, tc.argv...)
			if code != 0 {
				t.Fatalf("exit %d, stderr: %s", code, stderr)
			}
			for _, want := range tc.want {
				if !strings.Contains(stdout, want) {
					t.Errorf("output is missing %q:\n%s", want, stdout)
				}
			}
			for _, notWant := range tc.notWant {
				if strings.Contains(stdout, notWant) {
					t.Errorf("output should not mention %q:\n%s", notWant, stdout)
				}
			}
		})
	}
}

func TestListReportsStaleAnchors(t *testing.T) {
	code, stdout, stderr := run(t, "list", "--comments", seedFile(t))
	if code != 0 {
		t.Fatalf("exit %d, stderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, "stale anchor (gone)") {
		t.Errorf("a stale anchor was not flagged:\n%s", stdout)
	}
	if !strings.Contains(stdout, "reply agent: fixed in 3f1a") {
		t.Errorf("replies are not folded onto one line:\n%s", stdout)
	}
}

func TestExportFormats(t *testing.T) {
	path := seedFile(t)
	cases := map[string][]string{
		"md":     {"# Review comments", "## internal/gitx/blob.go:42-44"},
		"prompt": {"# Code review comments", "42 | for {"},
		"json":   {`"version": 1`, `"cmt_open"`},
	}
	for format, want := range cases {
		t.Run(format, func(t *testing.T) {
			code, stdout, stderr := run(t, "export", "--format", format, "--comments", path)
			if code != 0 {
				t.Fatalf("exit %d, stderr: %s", code, stderr)
			}
			for _, fragment := range want {
				if !strings.Contains(stdout, fragment) {
					t.Errorf("%s output is missing %q:\n%s", format, fragment, stdout)
				}
			}
		})
	}
}

func TestExportToFile(t *testing.T) {
	out := filepath.Join(t.TempDir(), "review.md")
	code, stdout, stderr := run(t, "export", "-o", out, "--comments", seedFile(t))
	if code != 0 {
		t.Fatalf("exit %d, stderr: %s", code, stderr)
	}
	if stdout != "" {
		t.Errorf("stdout should stay empty when -o is given, got %q", stdout)
	}
	raw, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read %s: %v", out, err)
	}
	if !strings.Contains(string(raw), "# Review comments") {
		t.Errorf("the file does not hold the markdown export:\n%s", raw)
	}
}

func TestUsageErrors(t *testing.T) {
	path := seedFile(t)
	cases := [][]string{
		{},
		{"nonsense"},
		{"list", "--comments", path, "--status", "maybe"},
		{"export", "--comments", path, "--format", "pdf"},
	}
	for _, argv := range cases {
		if code, _, _ := run(t, argv...); code != 2 {
			t.Errorf("Comments(%v) exited %d, want 2", argv, code)
		}
	}
}

func TestMissingFile(t *testing.T) {
	code, _, stderr := run(t, "list", "--comments", filepath.Join(t.TempDir(), "absent.json"))
	if code != 1 {
		t.Errorf("exit %d, want 1", code)
	}
	if !strings.Contains(stderr, "does not exist yet") {
		t.Errorf("stderr = %q", stderr)
	}
}

func TestHelp(t *testing.T) {
	code, stdout, _ := run(t, "--help")
	if code != 0 {
		t.Errorf("exit %d, want 0", code)
	}
	if !strings.Contains(stdout, "dv comments export") {
		t.Errorf("help text is missing the export usage:\n%s", stdout)
	}
}
