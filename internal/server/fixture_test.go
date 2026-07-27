package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/alde/dv/internal/comments"
	"github.com/alde/dv/internal/gitx"
	"github.com/alde/dv/internal/model"
)

const (
	fixtureDate  = "2026-01-02T03:04:05+00:00"
	fixtureToken = "test-token-abcdefghijklmnop"
)

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

func newFixture(t *testing.T) *fixture {
	t.Helper()
	hermeticEnv(t)
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("eval symlinks: %v", err)
	}
	f := &fixture{t: t, Root: root}
	f.git("init", "-q", "-b", "main", ".")
	f.git("config", "user.name", "Fixture User")
	f.git("config", "user.email", "fixture@example.com")
	f.git("config", "commit.gpgsign", "false")
	f.git("config", "core.autocrlf", "false")
	return f
}

func (f *fixture) git(args ...string) string {
	f.t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = f.Root
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		f.t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, stderr.String())
	}
	return string(out)
}

func (f *fixture) write(name, content string) {
	f.t.Helper()
	full := filepath.Join(f.Root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		f.t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		f.t.Fatalf("write %s: %v", name, err)
	}
}

func (f *fixture) remove(name string) {
	f.t.Helper()
	if err := os.Remove(filepath.Join(f.Root, filepath.FromSlash(name))); err != nil {
		f.t.Fatalf("remove %s: %v", name, err)
	}
}

func (f *fixture) commit(message string) {
	f.t.Helper()
	f.git("add", "-A", ".")
	f.git("commit", "-q", "--allow-empty", "-m", message)
}

const (
	appV1 = "package app\n\nfunc Run() error {\n\treturn nil\n}\n"
	appV2 = "package app\n\nimport \"errors\"\n\nfunc Run() error {\n\treturn errors.New(\"boom\")\n}\n"
)

func seedRepo(t *testing.T) *fixture {
	t.Helper()
	f := newFixture(t)
	f.write("README.md", "# demo\n")
	f.write("src/app.go", appV1)
	f.write("src/legacy.go", "package app\n\nconst Legacy = 1\n")
	f.commit("initial")

	f.write("src/app.go", appV2)
	f.write("docs/guide.md", "# guide\n\nRead this first.\n")
	f.remove("src/legacy.go")
	f.commit("second")
	return f
}

type harness struct {
	t      *testing.T
	fx     *fixture
	server *Server
	http   *httptest.Server
	store  *comments.Store
}

type harnessOptions struct {
	args     []string
	assets   fstest.MapFS
	comments bool
	defaults model.Defaults
	token    string
	noToken  bool
}

func newHarness(t *testing.T, f *fixture, configure func(*harnessOptions)) *harness {
	t.Helper()
	opts := harnessOptions{args: []string{"HEAD~1", "HEAD"}, comments: true, token: fixtureToken}
	if configure != nil {
		configure(&opts)
	}

	repo, err := gitx.Open(f.Root)
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	spec, err := gitx.ResolveSpec(repo, opts.args)
	if err != nil {
		t.Fatalf("resolve spec %v: %v", opts.args, err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	var store *comments.Store
	if opts.comments {
		store, err = comments.New(comments.Config{
			Repo:      model.RepoRef{Root: f.Root},
			Spec:      spec.Model(),
			Generator: "dv/test",
			Author:    model.Author{Name: "Fixture User", Email: "fixture@example.com"},
			Logger:    logger,
		})
		if err != nil {
			t.Fatalf("comments store: %v", err)
		}
	}

	token := opts.token
	if opts.noToken {
		token = ""
	}
	srv, err := New(Options{
		Repo:     repo,
		Spec:     spec,
		Git:      gitx.Options{MaxBlob: 2 << 20},
		Store:    store,
		Assets:   opts.assets,
		Defaults: opts.defaults,
		Token:    token,
		Version:  "test",
		Workers:  2,
		Logger:   logger,
	})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}

	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() {
		srv.stopStreams()
		ts.Close()
	})
	return &harness{t: t, fx: f, server: srv, http: ts, store: store}
}

func (h *harness) request(method, path string, body string, headers map[string]string) *http.Response {
	h.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, h.http.URL+path, reader)
	if err != nil {
		h.t.Fatalf("build request: %v", err)
	}
	req.Header.Set(TokenHeader, fixtureToken)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		if value == "" {
			req.Header.Del(name)
			continue
		}
		req.Header.Set(name, value)
	}
	res, err := h.http.Client().Do(req)
	if err != nil {
		h.t.Fatalf("%s %s: %v", method, path, err)
	}
	h.t.Cleanup(func() { res.Body.Close() })
	return res
}

func (h *harness) get(path string) *http.Response {
	h.t.Helper()
	return h.request(http.MethodGet, path, "", nil)
}

func (h *harness) decode(res *http.Response, into any) {
	h.t.Helper()
	if err := json.NewDecoder(res.Body).Decode(into); err != nil {
		h.t.Fatalf("decode %s: %v", res.Request.URL.Path, err)
	}
}

func readBody(t *testing.T, res *http.Response) string {
	t.Helper()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return string(raw)
}

func (h *harness) fileID(path string) string {
	h.t.Helper()
	return gitx.FileID(path)
}

func (h *harness) commentsPath() string {
	h.t.Helper()
	return h.store.Path()
}

func wantStatus(t *testing.T, res *http.Response, want int) {
	t.Helper()
	if res.StatusCode != want {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("%s %s: got status %d, want %d\n%s", res.Request.Method, res.Request.URL.Path, res.StatusCode, want, raw)
	}
}
