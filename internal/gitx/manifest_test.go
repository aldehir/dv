package gitx

import (
	"slices"
	"strings"
	"testing"

	"github.com/alde/dv/internal/model"
)

func TestManifestEmptyDiff(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "a\n")
	f.add()
	f.commit("c1")

	r := f.repo()
	m, err := r.Manifest(f.resolve(), Options{Untracked: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Files) != 0 {
		t.Errorf("Files = %v, want none", manifestPaths(m))
	}
	if m.Files == nil {
		t.Error("Files should be an empty slice, not nil, so it marshals to []")
	}
	if m.Totals != (model.Totals{}) {
		t.Errorf("Totals = %+v, want zero", m.Totals)
	}
}

func TestManifestCountsAndTotals(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "1\n2\n3\n")
	f.write("gone.txt", "x\n")
	f.add()
	f.commit("c1")

	f.write("a.txt", "1\n2\n3\n4\n5\n")
	f.rm("gone.txt")
	f.write("added.txt", "new\n")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestPaths(m); !slices.Equal(got, []string{"a.txt", "added.txt", "gone.txt"}) {
		t.Fatalf("paths = %v, want sorted a.txt, added.txt, gone.txt", got)
	}
	if e := entryFor(t, m, "a.txt"); e.Additions != 2 || e.Deletions != 0 || e.Status != model.StatusModified {
		t.Errorf("a.txt = %+v", e)
	}
	if e := entryFor(t, m, "gone.txt"); e.Status != model.StatusDeleted || e.Deletions != 1 {
		t.Errorf("gone.txt = %+v", e)
	}
	if e := entryFor(t, m, "added.txt"); e.Status != model.StatusAdded || e.Additions != 1 {
		t.Errorf("added.txt = %+v", e)
	}
	want := model.Totals{Files: 3, Additions: 3, Deletions: 1}
	if m.Totals != want {
		t.Errorf("Totals = %+v, want %+v", m.Totals, want)
	}
	for _, e := range m.Files {
		if e.ID != FileID(e.Path) {
			t.Errorf("%s: ID = %q, want %q", e.Path, e.ID, FileID(e.Path))
		}
	}
}

func TestManifestUntracked(t *testing.T) {
	f := newFixture(t)
	f.write("tracked.txt", "a\n")
	f.add()
	f.commit("c1")
	f.write("notes/todo.md", "one\ntwo\n")
	f.writeBytes("blob.bin", []byte{0x00, 0x01, 0x02, 0xff})
	f.symlink("tracked.txt", "alias")

	r := f.repo()
	s := f.resolve()

	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Files) != 0 {
		t.Fatalf("without Untracked, files = %v", manifestPaths(m))
	}

	m, err = r.Manifest(s, Options{Untracked: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestPaths(m); !slices.Equal(got, []string{"alias", "blob.bin", "notes/todo.md"}) {
		t.Fatalf("paths = %v", got)
	}

	todo := entryFor(t, m, "notes/todo.md")
	if todo.Status != model.StatusUntracked || todo.Additions != 2 || todo.Deletions != 0 {
		t.Errorf("notes/todo.md = %+v", todo)
	}
	if todo.Mode.Old != "000000" || todo.Mode.New != "100644" {
		t.Errorf("notes/todo.md mode = %+v", todo.Mode)
	}
	if !isZeroSha(todo.OldSha) || !isZeroSha(todo.NewSha) {
		t.Errorf("untracked shas should be zero, got %q %q", todo.OldSha, todo.NewSha)
	}

	if bin := entryFor(t, m, "blob.bin"); !bin.Binary || bin.Additions != 0 {
		t.Errorf("blob.bin = %+v, want binary", bin)
	}
	if link := entryFor(t, m, "alias"); !link.Symlink || link.Mode.New != "120000" {
		t.Errorf("alias = %+v, want symlink", link)
	}

	p, err := r.File(s, todo, Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"new file mode 100644", "--- /dev/null", "+++ b/notes/todo.md", "+one", "+two"} {
		if !strings.Contains(p.Patch, want) {
			t.Errorf("synthesized patch missing %q:\n%s", want, p.Patch)
		}
	}
	if !slices.Equal(p.NewLines, []string{"one", "two"}) {
		t.Errorf("NewLines = %#v", p.NewLines)
	}
	if len(p.OldLines) != 0 || p.OldLines == nil {
		t.Errorf("OldLines = %#v, want empty non-nil", p.OldLines)
	}
}

func TestManifestUntrackedHonoursPathspecAndSide(t *testing.T) {
	f := newFixture(t)
	f.write("src/a.txt", "a\n")
	f.add()
	f.commit("c1")
	f.write("src/new.txt", "x\n")
	f.write("docs/new.md", "y\n")

	r := f.repo()

	scoped := f.resolve("--", "src/")
	m, err := r.Manifest(scoped, Options{Untracked: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestPaths(m); !slices.Equal(got, []string{"src/new.txt"}) {
		t.Errorf("pathspec-limited untracked = %v", got)
	}

	staged := f.resolve("--cached")
	m, err = r.Manifest(staged, Options{Untracked: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Files) != 0 {
		t.Errorf("untracked files leaked into a staged diff: %v", manifestPaths(m))
	}
}

func TestManifestBinary(t *testing.T) {
	f := newFixture(t)
	f.writeBytes("img.bin", []byte{0x00, 'a', 0x01, 'b'})
	f.add()
	f.commit("c1")
	f.writeBytes("img.bin", []byte{0x00, 'a', 0x01, 'c', 0x00})
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "img.bin")
	if !e.Binary {
		t.Fatalf("img.bin = %+v, want Binary", e)
	}
	if e.Additions != 0 || e.Deletions != 0 {
		t.Errorf("binary counts = +%d -%d, want 0/0", e.Additions, e.Deletions)
	}
	p, err := r.File(s, e, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !p.Binary || p.OldLines != nil || p.NewLines != nil {
		t.Errorf("payload = %+v, want binary with nil lines", p)
	}
	if !strings.Contains(p.Patch, "Binary files") {
		t.Errorf("patch does not mark the file binary:\n%s", p.Patch)
	}
	if p.OldSize == 0 || p.NewSize == 0 {
		t.Errorf("sizes = %d/%d, want both non-zero", p.OldSize, p.NewSize)
	}
}

func TestManifestRename(t *testing.T) {
	f := newFixture(t)
	body := strings.Repeat("stable line\n", 40)
	f.write("old/name.txt", body)
	f.add()
	f.commit("c1")
	f.mkdir("new")
	f.git("mv", "old/name.txt", "new/name.txt")
	f.write("new/name.txt", body+"one more\n")
	f.add()

	r := f.repo()
	s := f.resolve("--cached", "-M")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "new/name.txt")
	if e.Status != model.StatusRenamed {
		t.Fatalf("status = %q, want renamed (%+v)", e.Status, e)
	}
	if e.PrevPath != "old/name.txt" {
		t.Errorf("PrevPath = %q", e.PrevPath)
	}
	if e.Score <= 0 || e.Score > 100 {
		t.Errorf("Score = %d, want a similarity percentage", e.Score)
	}

	p, err := r.File(s, e, Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"rename from old/name.txt", "rename to new/name.txt", "similarity index"} {
		if !strings.Contains(p.Patch, want) {
			t.Errorf("per-file patch lost the rename (%q missing):\n%s", want, p.Patch)
		}
	}
	if len(p.OldLines) != 40 {
		t.Errorf("OldLines = %d lines, want 40", len(p.OldLines))
	}
	if len(p.NewLines) != 41 {
		t.Errorf("NewLines = %d lines, want 41", len(p.NewLines))
	}
}

func TestManifestCopy(t *testing.T) {
	f := newFixture(t)
	body := strings.Repeat("copied line\n", 40)
	f.write("orig.txt", body)
	f.add()
	f.commit("c1")
	f.write("dup.txt", body)
	f.add()

	r := f.repo()
	s := f.resolve("--cached", "-C", "--find-copies-harder")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "dup.txt")
	if e.Status != model.StatusCopied {
		t.Fatalf("status = %q, want copied (%+v)", e.Status, e)
	}
	if e.PrevPath != "orig.txt" || e.Score != 100 {
		t.Errorf("copy metadata = prev %q score %d", e.PrevPath, e.Score)
	}
	p, err := r.File(s, e, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(p.Patch, "copy from orig.txt") {
		t.Errorf("per-file patch lost the copy:\n%s", p.Patch)
	}
}

func TestManifestModeOnlyChange(t *testing.T) {
	f := newFixture(t)
	f.write("script.sh", "#!/bin/sh\necho hi\n")
	f.add()
	f.commit("c1")
	f.chmod("script.sh", 0o755)
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "script.sh")
	if e.Mode.Old != "100644" || e.Mode.New != "100755" {
		t.Fatalf("mode = %+v, want 100644 -> 100755", e.Mode)
	}
	if e.Additions != 0 || e.Deletions != 0 {
		t.Errorf("counts = +%d -%d, want 0/0", e.Additions, e.Deletions)
	}
	if e.OldSha != e.NewSha {
		t.Errorf("mode-only change should keep the blob: %q vs %q", e.OldSha, e.NewSha)
	}
	p, err := r.File(s, e, Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"old mode 100644", "new mode 100755"} {
		if !strings.Contains(p.Patch, want) {
			t.Errorf("patch missing %q:\n%s", want, p.Patch)
		}
	}
	if strings.Contains(p.Patch, "@@") {
		t.Errorf("mode-only patch should have no hunks:\n%s", p.Patch)
	}
	if !slices.Equal(p.OldLines, p.NewLines) {
		t.Errorf("mode-only change should have identical content, got %#v vs %#v", p.OldLines, p.NewLines)
	}
}

func TestManifestSymlink(t *testing.T) {
	f := newFixture(t)
	f.write("target.txt", "t\n")
	f.write("other.txt", "o\n")
	f.symlink("target.txt", "link")
	f.add()
	f.commit("c1")
	f.symlink("other.txt", "link")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "link")
	if !e.Symlink || e.Mode.Old != "120000" || e.Mode.New != "120000" {
		t.Fatalf("link = %+v, want a symlink on both sides", e)
	}
	p, err := r.File(s, e, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(p.OldLines, []string{"target.txt"}) {
		t.Errorf("OldLines = %#v, want the old link target", p.OldLines)
	}
	if !slices.Equal(p.NewLines, []string{"other.txt"}) {
		t.Errorf("NewLines = %#v, want the new link target", p.NewLines)
	}
	if !strings.Contains(p.Patch, "-target.txt") || !strings.Contains(p.Patch, "+other.txt") {
		t.Errorf("patch does not show the link targets:\n%s", p.Patch)
	}
}

func TestManifestSymlinkInWorktree(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "a\n")
	f.write("b.txt", "b\n")
	f.symlink("a.txt", "link")
	f.add()
	f.commit("c1")
	f.symlink("b.txt", "link")

	r := f.repo()
	s := f.resolve()
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "link")
	if !e.Symlink {
		t.Fatalf("link = %+v", e)
	}
	p, err := r.File(s, e, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(p.NewLines, []string{"b.txt"}) {
		t.Errorf("NewLines = %#v, want the worktree link target", p.NewLines)
	}
}

func TestManifestSubmodule(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "a\n")
	f.add()
	first := f.commit("c1")
	f.git("update-index", "--add", "--cacheinfo", "160000,"+first+",sub")
	f.git("commit", "-q", "-m", "add gitlink")
	f.write("a.txt", "a\nb\n")
	f.add("a.txt")
	second := f.commit("c2")
	f.git("update-index", "--add", "--cacheinfo", "160000,"+second+",sub")

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "sub")
	if !e.Submodule {
		t.Fatalf("sub = %+v, want Submodule", e)
	}
	if e.Mode.Old != "160000" || e.Mode.New != "160000" {
		t.Errorf("mode = %+v", e.Mode)
	}
	if e.OldSha != first || e.NewSha != second {
		t.Errorf("gitlink shas = %q %q, want %q %q", e.OldSha, e.NewSha, first, second)
	}
	p, err := r.File(s, e, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if p.OldLines != nil || p.NewLines != nil {
		t.Errorf("submodule payload should not carry lines: %#v %#v", p.OldLines, p.NewLines)
	}
	if !strings.Contains(p.Patch, "Subproject commit "+second) {
		t.Errorf("patch missing the subproject line:\n%s", p.Patch)
	}
}

func TestManifestTypeChange(t *testing.T) {
	f := newFixture(t)
	f.write("thing", "content\n")
	f.write("target.txt", "t\n")
	f.add()
	f.commit("c1")
	f.rm("thing")
	f.symlink("target.txt", "thing")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	e := entryFor(t, m, "thing")
	if e.Status != model.StatusTypeChange {
		t.Errorf("status = %q, want typechange", e.Status)
	}
	if !e.Symlink || e.Mode.Old != "100644" || e.Mode.New != "120000" {
		t.Errorf("thing = %+v", e)
	}
}

func TestManifestNoNewlineAtEOF(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "one\ntwo\n")
	f.add()
	f.commit("c1")
	f.write("a.txt", "one\ntwo")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	p, err := r.File(s, entryFor(t, m, "a.txt"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(p.Patch, "\\ No newline at end of file") {
		t.Errorf("patch lost the no-newline marker:\n%s", p.Patch)
	}
	if !slices.Equal(p.OldLines, []string{"one", "two"}) {
		t.Errorf("OldLines = %#v", p.OldLines)
	}
	if !slices.Equal(p.NewLines, []string{"one", "two"}) {
		t.Errorf("NewLines = %#v, a missing trailing newline must not add or drop a line", p.NewLines)
	}
}

func TestManifestLargeFile(t *testing.T) {
	f := newFixture(t)
	small := "tiny\n"
	big := strings.Repeat("0123456789abcdef\n", 64)
	f.write("small.txt", small)
	f.write("big.txt", big)
	f.add()
	f.commit("c1")
	f.write("small.txt", small+"more\n")
	f.write("big.txt", big+"more\n")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	o := Options{MaxBlob: 256}
	m, err := r.Manifest(s, o)
	if err != nil {
		t.Fatal(err)
	}
	bigEntry := entryFor(t, m, "big.txt")
	if !bigEntry.TooLarge {
		t.Errorf("big.txt = %+v, want TooLarge", bigEntry)
	}
	smallEntry := entryFor(t, m, "small.txt")
	if smallEntry.TooLarge {
		t.Errorf("small.txt = %+v, want not TooLarge", smallEntry)
	}

	p, err := r.File(s, bigEntry, o)
	if err != nil {
		t.Fatal(err)
	}
	if !p.TooLarge || p.OldLines != nil || p.NewLines != nil {
		t.Errorf("large payload = TooLarge %v lines %v/%v, want lines omitted", p.TooLarge, p.OldLines != nil, p.NewLines != nil)
	}
	if p.Patch == "" {
		t.Error("large files should still ship the patch")
	}
	if p.NewSize <= 256 {
		t.Errorf("NewSize = %d, want the real blob size", p.NewSize)
	}

	p, err = r.File(s, smallEntry, o)
	if err != nil {
		t.Fatal(err)
	}
	if p.TooLarge || p.NewLines == nil {
		t.Errorf("small payload should carry lines, got %+v", p)
	}

	if def := (Options{}); def.maxBlob() != DefaultMaxBlob {
		t.Errorf("default MaxBlob = %d, want %d", def.maxBlob(), DefaultMaxBlob)
	}
}

func TestManifestUnmergedPathAppearsOnce(t *testing.T) {
	f := newFixture(t)
	f.write("conflict.txt", "base\n")
	f.add()
	f.commit("base")
	f.git("checkout", "-q", "-b", "side")
	f.write("conflict.txt", "side\n")
	f.add()
	f.commit("side")
	f.git("checkout", "-q", "main")
	f.write("conflict.txt", "main\n")
	f.add()
	f.commit("main")
	if _, err := f.gitTry("merge", "side"); err == nil {
		t.Fatal("expected the merge to conflict")
	}

	r := f.repo()
	s := f.resolve()
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestPaths(m); !slices.Equal(got, []string{"conflict.txt"}) {
		t.Fatalf("paths = %v, want conflict.txt exactly once", got)
	}
	e := entryFor(t, m, "conflict.txt")
	if e.Status != model.StatusUnmerged {
		t.Errorf("status = %q, want unmerged", e.Status)
	}
	if _, err := r.File(s, e, Options{}); err != nil {
		t.Fatalf("File on an unmerged entry: %v", err)
	}
}

func TestManifestCRLFPreserved(t *testing.T) {
	f := newFixture(t)
	f.write("crlf.txt", "one\r\ntwo\r\n")
	f.add()
	f.commit("c1")
	f.write("crlf.txt", "one\r\ntwo\r\nthree\r\n")
	f.add()

	r := f.repo()
	s := f.resolve("--cached")
	m, err := r.Manifest(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	p, err := r.File(s, entryFor(t, m, "crlf.txt"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(p.NewLines, []string{"one\r", "two\r", "three\r"}) {
		t.Errorf("NewLines = %#v, want carriage returns preserved", p.NewLines)
	}
}
