package gitx

import (
	"slices"
	"strings"
	"testing"

	"github.com/alde/dv/internal/model"
)

func passthroughFixture(t *testing.T) *fixture {
	f := newFixture(t)
	body := strings.Repeat("shared line\n", 30)
	f.write("moved.txt", body)
	f.write("spaced.txt", "alpha\nbeta\n")
	f.write("blanks.txt", "alpha\nbeta\n")
	f.write("plain.txt", "alpha\n")
	f.write("vendor.lock", "1\n")
	f.add()
	f.commit("c1")

	f.mkdir("sub")
	f.git("mv", "moved.txt", "sub/moved.txt")
	f.write("sub/moved.txt", body+"tail\n")
	f.write("spaced.txt", "alpha   \n   beta\n")
	f.write("blanks.txt", "alpha\n\n\nbeta\n")
	f.write("plain.txt", "alpha\nbravo\n")
	f.write("fresh.txt", "brand new\n")
	f.rm("vendor.lock")
	f.add()
	return f
}

func TestPassthroughDiffOptions(t *testing.T) {
	tests := [][]string{
		{"-M"},
		{"--find-renames"},
		{"--find-renames=50"},
		{"-M50"},
		{"-C", "--find-copies-harder"},
		{"--find-copies"},
		{"--no-renames"},
		{"-w"},
		{"--ignore-all-space"},
		{"-b"},
		{"--ignore-blank-lines"},
		{"--diff-filter=M"},
		{"--diff-filter=A"},
		{"-R"},
		{"--relative"},
		{"--submodule=log"},
		{"-U0"},
		{"--unified=1"},
		{"-M", "--diff-filter=R"},
	}

	for _, flags := range tests {
		t.Run(strings.Join(flags, " "), func(t *testing.T) {
			f := passthroughFixture(t)
			args := append(slices.Clone(flags), "--cached")
			s := f.resolve(args...)
			if !slices.Equal(s.DiffOpts, flags) {
				t.Fatalf("DiffOpts = %v, want %v", s.DiffOpts, flags)
			}

			got := f.manifest(s, Options{})
			want := f.nameOnly(append(slices.Clone(flags), "--cached")...)
			slices.Sort(got)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				t.Errorf("manifest paths = %v, want git diff --name-only %v --cached = %v", got, flags, want)
			}

			r := f.repo()
			m, err := r.Manifest(s, Options{})
			if err != nil {
				t.Fatal(err)
			}
			for _, e := range m.Files {
				if _, err := r.File(s, e, Options{}); err != nil {
					t.Errorf("File(%s): %v", e.Path, err)
				}
			}
		})
	}
}

func TestPassthroughNoRenamesSplitsThePair(t *testing.T) {
	f := passthroughFixture(t)
	r := f.repo()

	withRenames, err := r.Manifest(f.resolve("--cached", "-M"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if e := entryFor(t, withRenames, "sub/moved.txt"); e.Status != model.StatusRenamed {
		t.Errorf("with -M: status = %q, want renamed", e.Status)
	}

	without, err := r.Manifest(f.resolve("--cached", "--no-renames"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if e := entryFor(t, without, "sub/moved.txt"); e.Status != model.StatusAdded {
		t.Errorf("with --no-renames: status = %q, want added", e.Status)
	}
	if e := entryFor(t, without, "moved.txt"); e.Status != model.StatusDeleted {
		t.Errorf("with --no-renames: moved.txt status = %q, want deleted", e.Status)
	}
}

func TestPassthroughReverseSwapsSides(t *testing.T) {
	f := passthroughFixture(t)
	r := f.repo()

	forward, err := r.Manifest(f.resolve("--cached", "--no-renames"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	reversed, err := r.Manifest(f.resolve("--cached", "--no-renames", "-R"), Options{})
	if err != nil {
		t.Fatal(err)
	}

	fresh := entryFor(t, forward, "fresh.txt")
	reversedFresh := entryFor(t, reversed, "fresh.txt")
	if fresh.Status != model.StatusAdded || reversedFresh.Status != model.StatusDeleted {
		t.Errorf("fresh.txt: forward %q, reversed %q; want added then deleted", fresh.Status, reversedFresh.Status)
	}
	if fresh.NewSha != reversedFresh.OldSha {
		t.Errorf("-R should swap blob shas: %q vs %q", fresh.NewSha, reversedFresh.OldSha)
	}
}

func TestPassthroughIgnoreWhitespace(t *testing.T) {
	f := passthroughFixture(t)
	r := f.repo()

	plain, err := r.Manifest(f.resolve("--cached"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	before := entryFor(t, plain, "spaced.txt")
	if before.Additions == 0 || before.Deletions == 0 {
		t.Fatalf("without -w, spaced.txt = +%d -%d, want non-zero", before.Additions, before.Deletions)
	}

	ignoredSpec := f.resolve("--cached", "-w")
	ignored, err := r.Manifest(ignoredSpec, Options{})
	if err != nil {
		t.Fatal(err)
	}
	// Git 2.54 drops a path whose every change is whitespace from --raw and
	// --numstat outright; older git still lists it at +0 -0. Either way the flag
	// reached git, which is all this passthrough test is about.
	after, listed := lookupEntry(ignored, "spaced.txt")
	if !listed {
		return
	}
	if after.Additions != 0 || after.Deletions != 0 {
		t.Errorf("-w did not reach numstat; spaced.txt = +%d -%d", after.Additions, after.Deletions)
	}
	p, err := r.File(ignoredSpec, after, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if p.Patch != "" {
		t.Errorf("-w did not reach the patch:\n%s", p.Patch)
	}
}

func TestManifestIDsAreStable(t *testing.T) {
	f := passthroughFixture(t)
	r := f.repo()
	s := f.resolve("--cached")

	first, err := r.Manifest(s, Options{Untracked: true})
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.Manifest(s, Options{Untracked: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Files) == 0 {
		t.Fatal("expected a non-empty manifest")
	}
	for i := range first.Files {
		if first.Files[i].ID != second.Files[i].ID {
			t.Errorf("ID for %s is not stable across runs", first.Files[i].Path)
		}
		path, err := PathFromFileID(first.Files[i].ID)
		if err != nil {
			t.Fatalf("PathFromFileID: %v", err)
		}
		if path != first.Files[i].Path {
			t.Errorf("ID for %s decodes to %q", first.Files[i].Path, path)
		}
	}
}
