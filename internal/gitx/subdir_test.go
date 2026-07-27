package gitx

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func subdirFixture(t *testing.T) *fixture {
	f := newFixture(t)
	f.write("src/keep.go", "package a\n")
	f.write("src/other.go", "package b\n")
	f.write("docs/readme.md", "hello\n")
	f.git("add", "-A")
	f.commit("base")
	f.write("src/keep.go", "package a\n\nvar X = 1\n")
	f.write("src/other.go", "package b\n\nvar Y = 2\n")
	f.write("docs/readme.md", "hello there\n")
	return f
}

func openAt(t *testing.T, dir string) *Repo {
	t.Helper()
	r, err := Open(dir)
	if err != nil {
		t.Fatalf("open %s: %v", dir, err)
	}
	return r
}

func TestPathspecIsRelativeToCwd(t *testing.T) {
	f := subdirFixture(t)
	sub := filepath.Join(f.Root, "src")

	spec, err := ResolveSpec(openAt(t, sub), []string{"--", "keep.go"})
	if err != nil {
		t.Fatalf("ResolveSpec: %v", err)
	}

	repo := openAt(t, sub)
	m, err := repo.Manifest(spec, Options{})
	if err != nil {
		t.Fatalf("Manifest: %v", err)
	}

	got := manifestPaths(m)
	want := []string{"src/keep.go"}
	if !slices.Equal(got, want) {
		t.Fatalf("pathspec from subdirectory: got %v, want %v", got, want)
	}
}

func TestManifestPathsStayRepoRelativeFromSubdir(t *testing.T) {
	f := subdirFixture(t)
	sub := filepath.Join(f.Root, "src")

	repo := openAt(t, sub)
	spec, err := ResolveSpec(repo, nil)
	if err != nil {
		t.Fatalf("ResolveSpec: %v", err)
	}

	m, err := repo.Manifest(spec, Options{})
	if err != nil {
		t.Fatalf("Manifest: %v", err)
	}

	for _, f := range m.Files {
		if strings.HasPrefix(f.Path, "..") || filepath.IsAbs(f.Path) {
			t.Errorf("path %q is not repo-relative", f.Path)
		}
	}

	got := manifestPaths(m)
	want := []string{"docs/readme.md", "src/keep.go", "src/other.go"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestUntrackedPathsAreRepoRelativeFromSubdir(t *testing.T) {
	f := subdirFixture(t)
	f.write("src/brand-new.go", "package c\n")
	sub := filepath.Join(f.Root, "src")

	repo := openAt(t, sub)
	spec, err := ResolveSpec(repo, nil)
	if err != nil {
		t.Fatalf("ResolveSpec: %v", err)
	}

	m, err := repo.Manifest(spec, Options{Untracked: true})
	if err != nil {
		t.Fatalf("Manifest: %v", err)
	}

	if !slices.Contains(manifestPaths(m), "src/brand-new.go") {
		t.Fatalf("untracked file not repo-relative: %v", manifestPaths(m))
	}
}

func TestFilePayloadResolvesFromSubdir(t *testing.T) {
	f := subdirFixture(t)
	sub := filepath.Join(f.Root, "src")

	repo := openAt(t, sub)
	spec, err := ResolveSpec(repo, nil)
	if err != nil {
		t.Fatalf("ResolveSpec: %v", err)
	}

	m, err := repo.Manifest(spec, Options{})
	if err != nil {
		t.Fatalf("Manifest: %v", err)
	}

	entry := entryFor(t, m, "src/keep.go")
	payload, err := repo.File(spec, entry, Options{})
	if err != nil {
		t.Fatalf("File: %v", err)
	}

	if !strings.Contains(payload.Patch, "var X = 1") {
		t.Errorf("patch missing change:\n%s", payload.Patch)
	}
	if len(payload.NewLines) != 3 {
		t.Errorf("NewLines = %v", payload.NewLines)
	}
}

func TestAmbiguousArgumentUsesCwdForFileCheck(t *testing.T) {
	f := subdirFixture(t)
	sub := filepath.Join(f.Root, "src")

	_, err := ResolveSpec(openAt(t, sub), []string{"nosuchthing"})
	if err == nil {
		t.Fatal("expected failure for a non-rev non-path argument")
	}

	if _, err := ResolveSpec(openAt(t, sub), []string{"--", "keep.go"}); err != nil {
		t.Errorf("cwd-relative pathspec rejected: %v", err)
	}
}
