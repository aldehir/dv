package gitx

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/alde/dv/internal/model"
)

func grammarFixture(t *testing.T) *fixture {
	f := newFixture(t)
	f.write("a.txt", "1\n")
	f.write("src/keep.go", "package src\n")
	f.add()
	f.commit("c1")

	f.write("a.txt", "1\n2\n")
	f.add()
	f.commit("c2")

	f.git("checkout", "-q", "-b", "feature")
	f.write("b.txt", "feature\n")
	f.write("src/keep.go", "package src\n\nvar Feature = true\n")
	f.add()
	f.commit("f1")

	f.git("checkout", "-q", "main")
	f.write("a.txt", "1\n2\n3\n")
	f.add()
	f.commit("c3")
	f.write("a.txt", "1\n2\n3\n4\n")
	f.write("src/keep.go", "package src\n\nvar Main = true\n")
	f.add()
	f.commit("c4")

	f.write("a.txt", "1\n2\n3\n4\nstaged\n")
	f.add("a.txt")
	f.write("a.txt", "1\n2\n3\n4\nstaged\nworktree\n")
	return f
}

func TestResolveSpecGrammar(t *testing.T) {
	tests := []struct {
		name      string
		args      []string
		kind      model.SpecKind
		left      func(f *fixture) string
		right     func(f *fixture) string
		mergeBase func(f *fixture) string
		paths     []string
		diffOpts  []string
		cached    bool
		gitEquiv  []string
	}{
		{
			name:     "no args is worktree vs index",
			args:     nil,
			kind:     model.SpecWorktree,
			gitEquiv: []string{},
		},
		{
			name:     "staged",
			args:     []string{"--staged"},
			kind:     model.SpecStaged,
			left:     func(f *fixture) string { return f.rev("HEAD") },
			cached:   true,
			gitEquiv: []string{"--staged"},
		},
		{
			name:     "cached",
			args:     []string{"--cached"},
			kind:     model.SpecStaged,
			left:     func(f *fixture) string { return f.rev("HEAD") },
			cached:   true,
			gitEquiv: []string{"--cached"},
		},
		{
			name:     "cached with commit",
			args:     []string{"--cached", "HEAD~1"},
			kind:     model.SpecStaged,
			left:     func(f *fixture) string { return f.rev("HEAD~1") },
			cached:   true,
			gitEquiv: []string{"--cached", "HEAD~1"},
		},
		{
			name:     "single commit vs worktree",
			args:     []string{"HEAD"},
			kind:     model.SpecCommit,
			left:     func(f *fixture) string { return f.rev("HEAD") },
			gitEquiv: []string{"HEAD"},
		},
		{
			name:     "two commits",
			args:     []string{"main", "feature"},
			kind:     model.SpecTwoDot,
			left:     func(f *fixture) string { return f.rev("main") },
			right:    func(f *fixture) string { return f.rev("feature") },
			gitEquiv: []string{"main", "feature"},
		},
		{
			name:     "two dot range",
			args:     []string{"main..feature"},
			kind:     model.SpecTwoDot,
			left:     func(f *fixture) string { return f.rev("main") },
			right:    func(f *fixture) string { return f.rev("feature") },
			gitEquiv: []string{"main..feature"},
		},
		{
			name:      "three dot range",
			args:      []string{"main...feature"},
			kind:      model.SpecThreeDot,
			left:      func(f *fixture) string { return f.rev("main") },
			right:     func(f *fixture) string { return f.rev("feature") },
			mergeBase: func(f *fixture) string { return strings.TrimSpace(f.git("merge-base", "main", "feature")) },
			gitEquiv:  []string{"main...feature"},
		},
		{
			name:     "left side of range defaults to HEAD",
			args:     []string{"..feature"},
			kind:     model.SpecTwoDot,
			left:     func(f *fixture) string { return f.rev("HEAD") },
			right:    func(f *fixture) string { return f.rev("feature") },
			gitEquiv: []string{"HEAD..feature"},
		},
		{
			name:     "right side of range defaults to HEAD",
			args:     []string{"feature.."},
			kind:     model.SpecTwoDot,
			left:     func(f *fixture) string { return f.rev("feature") },
			right:    func(f *fixture) string { return f.rev("HEAD") },
			gitEquiv: []string{"feature..HEAD"},
		},
		{
			name:     "pathspec limited",
			args:     []string{"HEAD~3", "--", "src/"},
			kind:     model.SpecCommit,
			left:     func(f *fixture) string { return f.rev("HEAD~3") },
			paths:    []string{"src/"},
			gitEquiv: []string{"HEAD~3", "--", "src/"},
		},
		{
			name:     "pathspec magic passes through",
			args:     []string{"--", ":(exclude)*.txt"},
			kind:     model.SpecWorktree,
			paths:    []string{":(exclude)*.txt"},
			gitEquiv: []string{"--", ":(exclude)*.txt"},
		},
		{
			name:     "implicit pathspec after rev",
			args:     []string{"HEAD~3", "src/"},
			kind:     model.SpecCommit,
			left:     func(f *fixture) string { return f.rev("HEAD~3") },
			paths:    []string{"src/"},
			gitEquiv: []string{"HEAD~3", "--", "src/"},
		},
		{
			name:     "implicit glob pathspec",
			args:     []string{"*.txt"},
			kind:     model.SpecWorktree,
			paths:    []string{"*.txt"},
			gitEquiv: []string{"--", "*.txt"},
		},
		{
			name:      "merge-base flag with two commits",
			args:      []string{"--merge-base", "main", "feature"},
			kind:      model.SpecMergeBase,
			left:      func(f *fixture) string { return f.rev("main") },
			right:     func(f *fixture) string { return f.rev("feature") },
			mergeBase: func(f *fixture) string { return strings.TrimSpace(f.git("merge-base", "main", "feature")) },
			gitEquiv:  []string{"--merge-base", "main", "feature"},
		},
		{
			name:      "merge-base flag with one commit",
			args:      []string{"--merge-base", "feature"},
			kind:      model.SpecMergeBase,
			left:      func(f *fixture) string { return f.rev("feature") },
			mergeBase: func(f *fixture) string { return strings.TrimSpace(f.git("merge-base", "feature", "HEAD")) },
			gitEquiv:  []string{"--merge-base", "feature"},
		},
		{
			name:     "passthrough diff options",
			args:     []string{"-w", "-M", "--diff-filter=M", "HEAD~1"},
			kind:     model.SpecCommit,
			left:     func(f *fixture) string { return f.rev("HEAD~1") },
			diffOpts: []string{"-w", "-M", "--diff-filter=M"},
			gitEquiv: []string{"-w", "-M", "--diff-filter=M", "HEAD~1"},
		},
		{
			name:     "options may follow revisions",
			args:     []string{"main", "feature", "-w"},
			kind:     model.SpecTwoDot,
			left:     func(f *fixture) string { return f.rev("main") },
			right:    func(f *fixture) string { return f.rev("feature") },
			diffOpts: []string{"-w"},
			gitEquiv: []string{"-w", "main", "feature"},
		},
		{
			name:     "unified passthrough",
			args:     []string{"-U0", "HEAD~1"},
			kind:     model.SpecCommit,
			left:     func(f *fixture) string { return f.rev("HEAD~1") },
			diffOpts: []string{"-U0"},
			gitEquiv: []string{"-U0", "HEAD~1"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := grammarFixture(t)
			s := f.resolve(tc.args...)

			if s.Kind != tc.kind {
				t.Errorf("Kind = %q, want %q", s.Kind, tc.kind)
			}
			wantLeft := ""
			if tc.left != nil {
				wantLeft = tc.left(f)
			}
			if s.Left != wantLeft {
				t.Errorf("Left = %q, want %q", s.Left, wantLeft)
			}
			wantRight := ""
			if tc.right != nil {
				wantRight = tc.right(f)
			}
			if s.Right != wantRight {
				t.Errorf("Right = %q, want %q", s.Right, wantRight)
			}
			wantBase := ""
			if tc.mergeBase != nil {
				wantBase = tc.mergeBase(f)
			}
			if s.MergeBase != wantBase {
				t.Errorf("MergeBase = %q, want %q", s.MergeBase, wantBase)
			}
			if !slices.Equal(s.Paths, tc.paths) {
				t.Errorf("Paths = %v, want %v", s.Paths, tc.paths)
			}
			if !slices.Equal(s.DiffOpts, tc.diffOpts) {
				t.Errorf("DiffOpts = %v, want %v", s.DiffOpts, tc.diffOpts)
			}
			if s.Cached != tc.cached {
				t.Errorf("Cached = %v, want %v", s.Cached, tc.cached)
			}
			if !slices.Equal(s.Argv, tc.args) && !(len(s.Argv) == 0 && len(tc.args) == 0) {
				t.Errorf("Argv = %v, want %v", s.Argv, tc.args)
			}

			got := f.manifest(s, Options{})
			want := f.nameOnly(tc.gitEquiv...)
			slices.Sort(got)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				t.Errorf("manifest paths = %v, want git diff --name-only %v = %v", got, tc.gitEquiv, want)
			}

			m := s.Model()
			if m.Kind != s.Kind || m.Left != s.Left || m.Right != s.Right || m.MergeBase != s.MergeBase {
				t.Errorf("Model() = %+v, does not mirror spec", m)
			}
		})
	}
}

func TestResolveSpecAmbiguousRevAndFilename(t *testing.T) {
	f := grammarFixture(t)
	f.git("branch", "a.txt")

	_, err := ResolveSpec(f.repo(), []string{"a.txt"})
	if err == nil {
		t.Fatal("expected an ambiguity error")
	}
	want := "fatal: ambiguous argument 'a.txt': both revision and filename\n" +
		"Use '--' to separate paths from revisions, like this:\n" +
		"'git <command> [<revision>...] -- [<file>...]'"
	if err.Error() != want {
		t.Errorf("error =\n%s\nwant\n%s", err.Error(), want)
	}
	var fatal *FatalError
	if !errors.As(err, &fatal) || fatal.ExitCode != 128 {
		t.Errorf("want FatalError with exit code 128, got %#v", err)
	}

	gitOut, gitErr := f.gitTry("diff", "a.txt")
	if gitErr == nil {
		t.Fatal("expected git itself to reject the ambiguous argument")
	}
	if strings.TrimSpace(gitOut) != want {
		t.Errorf("git said\n%s\nwe said\n%s", strings.TrimSpace(gitOut), want)
	}

	if _, err := ResolveSpec(f.repo(), []string{"--", "a.txt"}); err != nil {
		t.Errorf("explicit -- should disambiguate, got %v", err)
	}
	if _, err := ResolveSpec(f.repo(), []string{"a.txt", "--"}); err != nil {
		t.Errorf("trailing -- should mark a.txt as a revision, got %v", err)
	}
}

func TestResolveSpecUnknownRevision(t *testing.T) {
	f := grammarFixture(t)

	for _, args := range [][]string{{"nosuchthing"}, {"nosuchthing", "--", "a.txt"}} {
		_, err := ResolveSpec(f.repo(), args)
		if err == nil {
			t.Fatalf("ResolveSpec(%v): expected an error", args)
		}
		want := "fatal: ambiguous argument 'nosuchthing': unknown revision or path not in the working tree.\n" +
			"Use '--' to separate paths from revisions, like this:\n" +
			"'git <command> [<revision>...] -- [<file>...]'"
		if err.Error() != want {
			t.Errorf("error =\n%s\nwant\n%s", err.Error(), want)
		}
	}

	gitOut, gitErr := f.gitTry("diff", "nosuchthing")
	if gitErr == nil {
		t.Fatal("expected git itself to reject the unknown revision")
	}
	if !strings.Contains(gitOut, "unknown revision or path not in the working tree") {
		t.Errorf("unexpected git message: %s", gitOut)
	}
}

func TestResolveSpecTooManyRevisions(t *testing.T) {
	f := grammarFixture(t)
	if _, err := ResolveSpec(f.repo(), []string{"main", "feature", "main"}); err == nil {
		t.Fatal("expected an error for three revisions")
	}
}

func TestResolveSpecUnknownFlagIsForwarded(t *testing.T) {
	f := grammarFixture(t)
	s := f.resolve("--frobnicate", "HEAD")
	if !slices.Contains(s.DiffOpts, "--frobnicate") {
		t.Fatalf("DiffOpts = %v, want the unknown flag forwarded", s.DiffOpts)
	}
	if _, err := f.repo().Manifest(s, Options{}); err == nil {
		t.Fatal("expected git to reject the unknown flag")
	}
}

func TestOpenNotARepo(t *testing.T) {
	hermeticEnv(t)
	root := tempDir(t)
	dir := filepath.Join(root, "nested")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CEILING_DIRECTORIES", root)

	_, err := Open(dir)
	if err == nil {
		t.Fatal("expected Open to fail outside a repository")
	}
	var fatal *FatalError
	if !errors.As(err, &fatal) {
		t.Fatalf("want *FatalError, got %#v", err)
	}
	if fatal.ExitCode != 128 {
		t.Errorf("ExitCode = %d, want 128", fatal.ExitCode)
	}
	if !strings.Contains(fatal.Message, "not a git repository") {
		t.Errorf("message %q does not mirror git", fatal.Message)
	}
}

func TestOpenAndHeadAndAuthor(t *testing.T) {
	f := grammarFixture(t)
	r := f.repo()
	if r.Root != f.Root {
		t.Errorf("Root = %q, want %q", r.Root, f.Root)
	}
	if want := filepath.Join(f.Root, ".git"); r.GitDir != want {
		t.Errorf("GitDir = %q, want %q", r.GitDir, want)
	}
	head, err := r.Head()
	if err != nil {
		t.Fatalf("Head: %v", err)
	}
	if head != f.rev("HEAD") {
		t.Errorf("Head = %q, want %q", head, f.rev("HEAD"))
	}
	author, err := r.Author()
	if err != nil {
		t.Fatalf("Author: %v", err)
	}
	if author.Name != "Fixture User" || author.Email != "fixture@example.com" {
		t.Errorf("Author = %+v", author)
	}
}

func TestUnbornHeadDoesNotPanic(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "hello\n")
	f.add()

	r := f.repo()
	head, err := r.Head()
	if err != nil {
		t.Fatalf("Head: %v", err)
	}
	if head != "" {
		t.Errorf("Head on unborn branch = %q, want empty", head)
	}

	for _, args := range [][]string{nil, {"--cached"}} {
		s, err := ResolveSpec(r, args)
		if err != nil {
			t.Fatalf("ResolveSpec(%v): %v", args, err)
		}
		m, err := r.Manifest(s, Options{Untracked: true})
		if err != nil {
			t.Fatalf("Manifest(%v): %v", args, err)
		}
		for _, e := range m.Files {
			if _, err := r.File(s, e, Options{}); err != nil {
				t.Fatalf("File(%v, %s): %v", args, e.Path, err)
			}
		}
	}

	if _, err := ResolveSpec(r, []string{"HEAD"}); err == nil {
		t.Error("expected HEAD to be unresolvable on an unborn branch")
	}
}

func TestStagedOnUnbornHead(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "one\ntwo\n")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	if s.Kind != model.SpecStaged || s.Left != "" {
		t.Fatalf("spec = %+v, want staged with empty Left", s)
	}
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "a.txt")
	if e.Status != model.StatusAdded {
		t.Errorf("Status = %q, want added", e.Status)
	}
	p, err := r.File(s, e, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.OldLines) != 0 || p.OldLines == nil {
		t.Errorf("OldLines = %#v, want empty non-nil", p.OldLines)
	}
	if !slices.Equal(p.NewLines, []string{"one", "two"}) {
		t.Errorf("NewLines = %#v", p.NewLines)
	}
}

func TestFileIDRoundTrip(t *testing.T) {
	paths := []string{
		"a.txt",
		"src/deep/nested/file.go",
		"weird name with spaces.txt",
		"ünïcode/pathé.md",
		"a+b/c=d?e",
	}
	seen := map[string]string{}
	for _, p := range paths {
		id := FileID(p)
		if strings.ContainsAny(id, "/?#&= +%") {
			t.Errorf("FileID(%q) = %q is not URL-safe", p, id)
		}
		if id != FileID(p) {
			t.Errorf("FileID(%q) is not stable", p)
		}
		if prev, ok := seen[id]; ok {
			t.Errorf("FileID collision between %q and %q", prev, p)
		}
		seen[id] = p
		back, err := PathFromFileID(id)
		if err != nil {
			t.Fatalf("PathFromFileID(%q): %v", id, err)
		}
		if back != p {
			t.Errorf("round trip of %q gave %q", p, back)
		}
	}
	if _, err := PathFromFileID("not*valid"); err == nil {
		t.Error("expected an error for a malformed id")
	}
}
