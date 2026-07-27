package gitx

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alde/dv/internal/model"
)

const fixtureDate = "2026-01-02T03:04:05+00:00"

type fixture struct {
	t    *testing.T
	Root string
}

func hermeticEnv(t *testing.T) {
	t.Helper()
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_SYSTEM", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_AUTHOR_DATE", fixtureDate)
	t.Setenv("GIT_COMMITTER_DATE", fixtureDate)
	t.Setenv("GIT_AUTHOR_NAME", "Fixture User")
	t.Setenv("GIT_AUTHOR_EMAIL", "fixture@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "Fixture User")
	t.Setenv("GIT_COMMITTER_EMAIL", "fixture@example.com")
	t.Setenv("GIT_TERMINAL_PROMPT", "0")
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
}

func tempDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("eval symlinks: %v", err)
	}
	return dir
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	hermeticEnv(t)
	f := &fixture{t: t, Root: tempDir(t)}
	f.git("init", "-q", "-b", "main", ".")
	f.git("config", "user.name", "Fixture User")
	f.git("config", "user.email", "fixture@example.com")
	f.git("config", "commit.gpgsign", "false")
	f.git("config", "core.autocrlf", "false")
	return f
}

func (f *fixture) git(args ...string) string {
	f.t.Helper()
	out, err := f.gitTry(args...)
	if err != nil {
		f.t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return out
}

func (f *fixture) gitTry(args ...string) (string, error) {
	f.t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = f.Root
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return stderr.String(), err
	}
	return string(out), nil
}

func (f *fixture) path(name string) string {
	return filepath.Join(f.Root, filepath.FromSlash(name))
}

func (f *fixture) write(name, content string) {
	f.t.Helper()
	f.writeBytes(name, []byte(content))
}

func (f *fixture) writeBytes(name string, content []byte) {
	f.t.Helper()
	full := f.path(name)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		f.t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, content, 0o644); err != nil {
		f.t.Fatalf("write %s: %v", name, err)
	}
}

func (f *fixture) mkdir(name string) {
	f.t.Helper()
	if err := os.MkdirAll(f.path(name), 0o755); err != nil {
		f.t.Fatalf("mkdir %s: %v", name, err)
	}
}

func (f *fixture) symlink(target, name string) {
	f.t.Helper()
	full := f.path(name)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		f.t.Fatalf("mkdir: %v", err)
	}
	os.Remove(full)
	if err := os.Symlink(target, full); err != nil {
		f.t.Fatalf("symlink %s: %v", name, err)
	}
}

func (f *fixture) chmod(name string, mode os.FileMode) {
	f.t.Helper()
	if err := os.Chmod(f.path(name), mode); err != nil {
		f.t.Fatalf("chmod %s: %v", name, err)
	}
}

func (f *fixture) rm(name string) {
	f.t.Helper()
	if err := os.Remove(f.path(name)); err != nil {
		f.t.Fatalf("remove %s: %v", name, err)
	}
}

func (f *fixture) add(paths ...string) {
	f.t.Helper()
	if len(paths) == 0 {
		paths = []string{"-A", "."}
	}
	f.git(append([]string{"add"}, paths...)...)
}

func (f *fixture) commit(msg string) string {
	f.t.Helper()
	f.git("commit", "-q", "--allow-empty", "-m", msg)
	return f.rev("HEAD")
}

func (f *fixture) rev(name string) string {
	f.t.Helper()
	return strings.TrimSpace(f.git("rev-parse", name))
}

func (f *fixture) repo() *Repo {
	f.t.Helper()
	r, err := Open(f.Root)
	if err != nil {
		f.t.Fatalf("open: %v", err)
	}
	return r
}

func (f *fixture) resolve(args ...string) *RevSpec {
	f.t.Helper()
	s, err := ResolveSpec(f.repo(), args)
	if err != nil {
		f.t.Fatalf("ResolveSpec(%v): %v", args, err)
	}
	return s
}

func (f *fixture) manifest(s *RevSpec, o Options) []string {
	f.t.Helper()
	m, err := f.repo().Manifest(s, o)
	if err != nil {
		f.t.Fatalf("Manifest: %v", err)
	}
	paths := make([]string, 0, len(m.Files))
	for _, e := range m.Files {
		paths = append(paths, e.Path)
	}
	return paths
}

func (f *fixture) nameOnly(args ...string) []string {
	f.t.Helper()
	out := f.git(append([]string{"diff", "--name-only"}, args...)...)
	var paths []string
	for _, line := range strings.Split(out, "\n") {
		if line != "" {
			paths = append(paths, line)
		}
	}
	return paths
}

func entryFor(t *testing.T, m *model.Manifest, path string) model.FileEntry {
	t.Helper()
	for _, e := range m.Files {
		if e.Path == path {
			return e
		}
	}
	t.Fatalf("no manifest entry for %q (have %v)", path, manifestPaths(m))
	return model.FileEntry{}
}

func manifestPaths(m *model.Manifest) []string {
	paths := make([]string, 0, len(m.Files))
	for _, e := range m.Files {
		paths = append(paths, e.Path)
	}
	return paths
}
