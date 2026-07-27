package gitx

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/alde/dv/internal/model"
)

func TestSplitLines(t *testing.T) {
	tests := []struct {
		in   string
		want []string
	}{
		{"", []string{}},
		{"a", []string{"a"}},
		{"a\n", []string{"a"}},
		{"a\nb", []string{"a", "b"}},
		{"a\nb\n", []string{"a", "b"}},
		{"\n", []string{""}},
		{"a\n\n", []string{"a", ""}},
		{"a\n\n\n", []string{"a", "", ""}},
		{"a\r\nb\r\n", []string{"a\r", "b\r"}},
	}
	for _, tc := range tests {
		got := splitLines([]byte(tc.in))
		if !slices.Equal(got, tc.want) {
			t.Errorf("splitLines(%q) = %#v, want %#v", tc.in, got, tc.want)
		}
		if got == nil {
			t.Errorf("splitLines(%q) returned nil; nil is reserved for unavailable content", tc.in)
		}
	}
}

func TestFilePayloadLineSplitting(t *testing.T) {
	tests := []struct {
		name  string
		old   string
		new   string
		wantO []string
		wantN []string
	}{
		{"trailing newline on both sides", "a\nb\n", "a\nB\n", []string{"a", "b"}, []string{"a", "B"}},
		{"new side loses its newline", "a\nb\n", "a\nB", []string{"a", "b"}, []string{"a", "B"}},
		{"old side had no newline", "a\nb", "a\nB\n", []string{"a", "b"}, []string{"a", "B"}},
		{"blank final line is real", "a\n", "a\n\n", []string{"a"}, []string{"a", ""}},
		{"emptied file", "a\n", "", []string{"a"}, []string{}},
		{"filled from empty", "", "a\n", []string{}, []string{"a"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			f.write("f.txt", tc.old)
			f.add()
			f.commit("c1")
			f.write("f.txt", tc.new)
			f.add()

			r := f.repo()
			s := f.resolve("--cached")
			m, err := r.Manifest(s, Options{})
			if err != nil {
				t.Fatal(err)
			}
			p, err := r.File(s, entryFor(t, m, "f.txt"), Options{})
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(p.OldLines, tc.wantO) {
				t.Errorf("OldLines = %#v, want %#v", p.OldLines, tc.wantO)
			}
			if !slices.Equal(p.NewLines, tc.wantN) {
				t.Errorf("NewLines = %#v, want %#v", p.NewLines, tc.wantN)
			}
		})
	}
}

func TestFilePayloadFields(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "one\ntwo\n")
	f.add()
	f.commit("c1")
	f.write("a.txt", "one\ntwo\nthree\n")

	r := f.repo()
	s := f.resolve()
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "a.txt")
	p, err := r.File(s, e, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if p.ID != e.ID || p.Path != e.Path || p.Status != e.Status {
		t.Errorf("payload identity = %+v, want to mirror %+v", p, e)
	}
	if p.OldSha != e.OldSha || p.NewSha != e.NewSha || p.Mode != e.Mode {
		t.Errorf("payload shas/modes = %q %q %+v", p.OldSha, p.NewSha, p.Mode)
	}
	if !isZeroSha(p.NewSha) {
		t.Errorf("NewSha for a worktree diff should be zero, got %q", p.NewSha)
	}
	if !slices.Equal(p.NewLines, []string{"one", "two", "three"}) {
		t.Errorf("NewLines = %#v, want the worktree content", p.NewLines)
	}
	if p.OldSize != 8 || p.NewSize != 14 {
		t.Errorf("sizes = %d/%d, want 8/14", p.OldSize, p.NewSize)
	}
	if !strings.HasPrefix(p.Patch, "diff --git a/a.txt b/a.txt\n") {
		t.Errorf("patch should be limited to this file:\n%s", p.Patch)
	}
	if strings.Count(p.Patch, "diff --git ") != 1 {
		t.Errorf("patch contains more than one file:\n%s", p.Patch)
	}
}

func TestFilePayloadDeletedFile(t *testing.T) {
	f := newFixture(t)
	f.write("gone.txt", "x\ny\n")
	f.add()
	f.commit("c1")
	f.rm("gone.txt")

	r := f.repo()
	s := f.resolve()
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	p, err := r.File(s, entryFor(t, m, "gone.txt"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(p.OldLines, []string{"x", "y"}) {
		t.Errorf("OldLines = %#v", p.OldLines)
	}
	if p.NewLines == nil || len(p.NewLines) != 0 {
		t.Errorf("NewLines = %#v, want empty non-nil for a deleted file", p.NewLines)
	}
}

func TestFilePayloadContextOption(t *testing.T) {
	f := newFixture(t)
	body := "1\n2\n3\n4\n5\n6\n7\n8\n9\n"
	f.write("a.txt", body)
	f.add()
	f.commit("c1")
	f.write("a.txt", "1\n2\n3\n4\nX\n6\n7\n8\n9\n")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "a.txt")

	tight, err := r.File(s, e, Options{Context: 1})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(tight.Patch, "@@ -4,3 +4,3 @@") {
		t.Errorf("Context 1 did not reach git:\n%s", tight.Patch)
	}

	wide, err := r.File(s, e, Options{Context: 5})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(wide.Patch, "@@ -1,9 +1,9 @@") {
		t.Errorf("Context 5 did not reach git:\n%s", wide.Patch)
	}

	userOpt := f.resolve("--cached", "-U0")
	m, err = r.Manifest(userOpt, Options{})
	if err != nil {
		t.Fatal(err)
	}
	explicit, err := r.File(userOpt, entryFor(t, m, "a.txt"), Options{Context: 5})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(explicit.Patch, "@@ -5 +5 @@") {
		t.Errorf("an explicit -U0 should win over Options.Context:\n%s", explicit.Patch)
	}
}

func TestBlob(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "one\ntwo\n")
	f.add()
	f.commit("c1")

	r := f.repo()
	sha := strings.TrimSpace(f.git("rev-parse", "HEAD:a.txt"))
	content, err := r.Blob(sha)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "one\ntwo\n" {
		t.Errorf("Blob = %q", content)
	}

	if _, err := r.Blob(ZeroSha); !errors.Is(err, ErrNotFound) {
		t.Errorf("Blob(zero) error = %v, want ErrNotFound", err)
	}
	if _, err := r.Blob("dead" + sha[4:]); !errors.Is(err, ErrNotFound) {
		t.Errorf("Blob(bogus) error = %v, want ErrNotFound", err)
	}
}

func TestSideContent(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "head\n")
	f.add()
	f.commit("c1")
	f.write("a.txt", "index\n")
	f.add("a.txt")
	f.write("a.txt", "worktree\n")

	r := f.repo()

	tests := []struct {
		name string
		args []string
		side model.AnnotationSide
		want []string
	}{
		{"worktree deletions is the index", nil, model.SideDeletions, []string{"index"}},
		{"worktree additions is the worktree", nil, model.SideAdditions, []string{"worktree"}},
		{"staged deletions is HEAD", []string{"--cached"}, model.SideDeletions, []string{"head"}},
		{"staged additions is the index", []string{"--cached"}, model.SideAdditions, []string{"index"}},
		{"commit deletions is the commit", []string{"HEAD"}, model.SideDeletions, []string{"head"}},
		{"commit additions is the worktree", []string{"HEAD"}, model.SideAdditions, []string{"worktree"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := f.resolve(tc.args...)
			lines, sha, err := r.SideContent(s, "a.txt", tc.side)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(lines, tc.want) {
				t.Errorf("lines = %#v, want %#v", lines, tc.want)
			}
			if len(sha) != 40 {
				t.Errorf("blob sha = %q, want a full object name", sha)
			}
		})
	}

	s := f.resolve()
	if _, _, err := r.SideContent(s, "missing.txt", model.SideAdditions); !errors.Is(err, ErrNotFound) {
		t.Errorf("SideContent for a missing worktree path = %v, want ErrNotFound", err)
	}
	if _, _, err := r.SideContent(s, "missing.txt", model.SideDeletions); !errors.Is(err, ErrNotFound) {
		t.Errorf("SideContent for a missing index path = %v, want ErrNotFound", err)
	}
}

func TestSideContentShaMatchesManifest(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "old\n")
	f.add()
	f.commit("c1")
	f.write("a.txt", "new\n")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "a.txt")

	_, oldSha, err := r.SideContent(s, "a.txt", model.SideDeletions)
	if err != nil {
		t.Fatal(err)
	}
	if oldSha != e.OldSha {
		t.Errorf("deletions sha = %q, want manifest OldSha %q", oldSha, e.OldSha)
	}
	_, newSha, err := r.SideContent(s, "a.txt", model.SideAdditions)
	if err != nil {
		t.Fatal(err)
	}
	if newSha != e.NewSha {
		t.Errorf("additions sha = %q, want manifest NewSha %q", newSha, e.NewSha)
	}
}

func TestThreeDotUsesMergeBaseContent(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "base\n")
	f.add()
	base := f.commit("base")

	f.git("checkout", "-q", "-b", "feature")
	f.write("a.txt", "feature\n")
	f.add()
	f.commit("feature")

	f.git("checkout", "-q", "main")
	f.write("a.txt", "main\n")
	f.write("only-on-main.txt", "m\n")
	f.add()
	f.commit("main")

	r := f.repo()
	s := f.resolve("main...feature")
	if s.MergeBase != base {
		t.Fatalf("MergeBase = %q, want %q", s.MergeBase, base)
	}
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestPaths(m); !slices.Equal(got, []string{"a.txt"}) {
		t.Fatalf("three-dot paths = %v, want only a.txt", got)
	}
	p, err := r.File(s, entryFor(t, m, "a.txt"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(p.OldLines, []string{"base"}) {
		t.Errorf("OldLines = %#v, want the merge-base content", p.OldLines)
	}
	if !slices.Equal(p.NewLines, []string{"feature"}) {
		t.Errorf("NewLines = %#v", p.NewLines)
	}

	lines, _, err := r.SideContent(s, "a.txt", model.SideDeletions)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(lines, []string{"base"}) {
		t.Errorf("SideContent deletions = %#v, want the merge-base content", lines)
	}
}

func TestTwoDotTreeToTree(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "v1\n")
	f.add()
	f.commit("c1")
	f.write("a.txt", "v2\n")
	f.add()
	f.commit("c2")
	f.write("a.txt", "uncommitted\n")

	r := f.repo()
	s := f.resolve("HEAD~1", "HEAD")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	p, err := r.File(s, entryFor(t, m, "a.txt"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(p.OldLines, []string{"v1"}) || !slices.Equal(p.NewLines, []string{"v2"}) {
		t.Errorf("tree-to-tree lines = %#v / %#v, worktree content must not leak in", p.OldLines, p.NewLines)
	}
}

func TestCommitSpecSeesStagedAndUnstaged(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "1\n")
	f.write("b.txt", "1\n")
	f.add()
	f.commit("c1")
	f.write("a.txt", "1\nstaged\n")
	f.add("a.txt")
	f.write("b.txt", "1\nunstaged\n")

	r := f.repo()
	m, err := r.Manifest(f.resolve("HEAD"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestPaths(m); !slices.Equal(got, []string{"a.txt", "b.txt"}) {
		t.Errorf("paths = %v, want both the staged and unstaged file", got)
	}
}

func TestPathspecLimitsManifest(t *testing.T) {
	f := newFixture(t)
	f.write("src/a.go", "package a\n")
	f.write("docs/b.md", "b\n")
	f.write("yarn.lock", "lock\n")
	f.add()
	f.commit("c1")
	f.write("src/a.go", "package a\n\nvar X = 1\n")
	f.write("docs/b.md", "b\nb\n")
	f.write("yarn.lock", "lock\nlock\n")
	f.add()

	r := f.repo()

	scoped := f.resolve("--cached", "--", "src/")
	m, err := r.Manifest(scoped, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestPaths(m); !slices.Equal(got, []string{"src/a.go"}) {
		t.Errorf("src/ scoped paths = %v", got)
	}

	excluded := f.resolve("--cached", "--", ":(exclude)*.lock")
	m, err = r.Manifest(excluded, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestPaths(m); !slices.Equal(got, []string{"docs/b.md", "src/a.go"}) {
		t.Errorf("exclude-scoped paths = %v", got)
	}
}

func TestPatchIsolatesFilesWithTrickyNames(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "1\n")
	f.write("a.txt.bak", "1\n")
	f.write("has space.txt", "1\n")
	f.write("star[1].txt", "1\n")
	f.add()
	f.commit("c1")
	f.write("a.txt", "2\n")
	f.write("a.txt.bak", "2\n")
	f.write("has space.txt", "2\n")
	f.write("star[1].txt", "2\n")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Files) != 4 {
		t.Fatalf("paths = %v, want 4 files", manifestPaths(m))
	}
	for _, e := range m.Files {
		p, err := r.File(s, e, Options{})
		if err != nil {
			t.Fatalf("File(%s): %v", e.Path, err)
		}
		if n := strings.Count(p.Patch, "diff --git "); n != 1 {
			t.Errorf("%s: patch covers %d files, want 1:\n%s", e.Path, n, p.Patch)
		}
		if !strings.Contains(p.Patch, "b/"+e.Path) {
			t.Errorf("%s: patch is for the wrong file:\n%s", e.Path, p.Patch)
		}
	}
}

func TestParseRawRejectsGarbage(t *testing.T) {
	if _, err := parseRaw([]byte("not-a-record\x00")); err == nil {
		t.Error("expected parseRaw to reject a malformed record")
	}
	if _, err := parseRaw([]byte(":100644 100644 aaa bbb R100\x00only-one-path\x00")); err == nil {
		t.Error("expected parseRaw to reject a truncated rename record")
	}
	if _, err := parseNumstat([]byte("bogus\x00")); err == nil {
		t.Error("expected parseNumstat to reject a malformed record")
	}
	entries, err := parseRaw(nil)
	if err != nil || entries != nil {
		t.Errorf("parseRaw(nil) = %v, %v", entries, err)
	}
}
