package server

import (
	"bytes"
	"encoding/json"
	"flag"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/alde/dv/internal/model"
)

var update = flag.Bool("update", false, "rewrite the golden files in testdata")

func golden(t *testing.T, name string, got any) {
	t.Helper()
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(got); err != nil {
		t.Fatalf("encode: %v", err)
	}
	path := filepath.Join("testdata", name)
	if *update {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatalf("mkdir testdata: %v", err)
		}
		if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s (run 'go test ./internal/server -update'): %v", path, err)
	}
	if !bytes.Equal(want, buf.Bytes()) {
		t.Errorf("%s does not match the golden file\n--- want ---\n%s\n--- got ---\n%s", name, want, buf.Bytes())
	}
}

func TestManifestGolden(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	res := h.get("/api/manifest")
	wantStatus(t, res, http.StatusOK)

	var manifest model.Manifest
	h.decode(res, &manifest)
	golden(t, "manifest.json", manifest)
}

func TestFileGolden(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	for _, path := range []string{"src/app.go", "src/legacy.go", "docs/guide.md"} {
		res := h.get("/api/file/" + h.fileID(path))
		wantStatus(t, res, http.StatusOK)
		var payload model.FilePayload
		h.decode(res, &payload)
		golden(t, "file_"+filepath.Base(path)+".json", payload)
	}
}

func TestSessionOmitsThemeWithoutFlag(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	var session model.Session
	h.decode(h.get("/api/session"), &session)

	if session.Defaults.Theme != "" {
		t.Errorf("defaults.theme = %q, want an empty string when no --theme was passed", session.Defaults.Theme)
	}
	if session.Spec.Kind != model.SpecTwoDot {
		t.Errorf("spec.kind = %q, want two-dot", session.Spec.Kind)
	}
	if session.RepoRoot != h.fx.Root {
		t.Errorf("repoRoot = %q, want %q", session.RepoRoot, h.fx.Root)
	}
	if !session.Comments {
		t.Error("comments = false, want true")
	}
}

func TestSessionCarriesExplicitTheme(t *testing.T) {
	h := newHarness(t, seedRepo(t), func(o *harnessOptions) {
		o.defaults = model.Defaults{Theme: "mocha", View: "unified", Wrap: true}
		o.comments = false
	})
	var session model.Session
	h.decode(h.get("/api/session"), &session)

	if session.Defaults.Theme != "mocha" {
		t.Errorf("defaults.theme = %q, want mocha", session.Defaults.Theme)
	}
	if session.Comments {
		t.Error("comments = true, want false when the store is disabled")
	}
}

func TestFileUnknownID(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	res := h.get("/api/file/" + h.fileID("does/not/exist.go"))
	wantStatus(t, res, http.StatusNotFound)
}

func TestFileMalformedID(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	for _, id := range []string{"not!base64", "@@@@", "aGVsbG8=="} {
		res := h.request(http.MethodGet, "/api/file/"+id, "", nil)
		if res.StatusCode != http.StatusBadRequest && res.StatusCode != http.StatusNotFound {
			t.Errorf("GET /api/file/%s = %d, want 400 or 404", id, res.StatusCode)
		}
	}
}

func TestCommentsDisabledReturns404(t *testing.T) {
	h := newHarness(t, seedRepo(t), func(o *harnessOptions) { o.comments = false })
	wantStatus(t, h.get("/api/comments"), http.StatusNotFound)
	wantStatus(t, h.request(http.MethodPost, "/api/comments", `{"body":"x"}`, nil), http.StatusNotFound)
}

func TestHealthz(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	res := h.request(http.MethodGet, "/healthz", "", map[string]string{TokenHeader: ""})
	wantStatus(t, res, http.StatusOK)

	var health map[string]string
	h.decode(res, &health)
	if health["status"] != "ok" {
		t.Errorf("status = %q, want ok", health["status"])
	}
	if health["version"] != "test" {
		t.Errorf("version = %q, want test", health["version"])
	}
}

func TestNosniffHeader(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	res := h.get("/api/session")
	if got := res.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
}
