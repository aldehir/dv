package server

import (
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

const indexTemplate = `<!doctype html>
<html><head><meta name="dv-token" content="` + TokenPlaceholder + `"></head><body></body></html>
`

func builtAssets() fstest.MapFS {
	return fstest.MapFS{
		"index.html":              {Data: []byte(indexTemplate)},
		"index.html.gz":           {Data: []byte("stale gzip of the placeholder")},
		"assets/app-abc123.js":    {Data: []byte("console.log('plain')")},
		"assets/app-abc123.js.gz": {Data: []byte("gzip bytes")},
		"assets/app-abc123.js.br": {Data: []byte("brotli bytes")},
		"assets/only-plain.css":   {Data: []byte("body{}")},
		"favicon.ico":             {Data: []byte("icon")},
	}
}

func assetHarness(t *testing.T) *harness {
	t.Helper()
	return newHarness(t, seedRepo(t), func(o *harnessOptions) { o.assets = builtAssets() })
}

func TestIndexSubstitutesToken(t *testing.T) {
	h := assetHarness(t)
	res := h.request(http.MethodGet, "/", "", map[string]string{TokenHeader: ""})
	wantStatus(t, res, http.StatusOK)

	body := readBody(t, res)
	if strings.Contains(body, TokenPlaceholder) {
		t.Error("index.html still contains the token placeholder")
	}
	if !strings.Contains(body, `content="`+fixtureToken+`"`) {
		t.Errorf("index.html does not carry the run token:\n%s", body)
	}
	if got := res.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
	if got := res.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", got)
	}
	if got := res.Header.Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, index.html must be served uncompressed so the token can be injected", got)
	}
}

func TestIndexPathServesTheSameDocument(t *testing.T) {
	h := assetHarness(t)
	res := h.request(http.MethodGet, "/index.html", "", nil)
	wantStatus(t, res, http.StatusOK)
	if !strings.Contains(readBody(t, res), fixtureToken) {
		t.Error("/index.html was not token-injected")
	}
}

func TestPrecompressedNegotiation(t *testing.T) {
	h := assetHarness(t)
	cases := []struct {
		name     string
		accept   string
		wantEnc  string
		wantBody string
	}{
		{"brotli preferred", "gzip, br", "br", "brotli bytes"},
		{"gzip only", "gzip", "gzip", "gzip bytes"},
		{"identity", "identity", "", "console.log('plain')"},
		{"gzip refused", "gzip;q=0", "", "console.log('plain')"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := h.request(http.MethodGet, "/assets/app-abc123.js", "", map[string]string{"Accept-Encoding": tc.accept})
			wantStatus(t, res, http.StatusOK)
			if got := res.Header.Get("Content-Encoding"); got != tc.wantEnc {
				t.Errorf("Content-Encoding = %q, want %q", got, tc.wantEnc)
			}
			if got := res.Header.Get("Vary"); got != "Accept-Encoding" {
				t.Errorf("Vary = %q, want Accept-Encoding", got)
			}
			if got := res.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/javascript") && !strings.HasPrefix(got, "application/javascript") {
				t.Errorf("Content-Type = %q, want a javascript type", got)
			}
			if got := res.Header.Get("Cache-Control"); got != immutableCache {
				t.Errorf("Cache-Control = %q, want %q", got, immutableCache)
			}
			if body := readBody(t, res); body != tc.wantBody {
				t.Errorf("body = %q, want %q", body, tc.wantBody)
			}
		})
	}
}

func TestPrecompressedFallsBackToPlain(t *testing.T) {
	h := assetHarness(t)
	res := h.request(http.MethodGet, "/assets/only-plain.css", "", map[string]string{"Accept-Encoding": "gzip, br"})
	wantStatus(t, res, http.StatusOK)
	if got := res.Header.Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, want the plain file when no sibling exists", got)
	}
	if body := readBody(t, res); body != "body{}" {
		t.Errorf("body = %q", body)
	}
}

func TestCompressedSiblingsAreNotAddressable(t *testing.T) {
	h := assetHarness(t)
	for _, path := range []string{"/index.html.gz", "/assets/app-abc123.js.br", "/assets/app-abc123.js.gz"} {
		res := h.request(http.MethodGet, path, "", nil)
		wantStatus(t, res, http.StatusNotFound)
	}
}

func TestUnknownExtensionlessPathFallsBackToIndex(t *testing.T) {
	h := assetHarness(t)
	res := h.request(http.MethodGet, "/some/deep/route", "", nil)
	wantStatus(t, res, http.StatusOK)
	if !strings.Contains(readBody(t, res), fixtureToken) {
		t.Error("the SPA fallback did not serve a token-injected index.html")
	}
}

func TestUnknownFileIs404(t *testing.T) {
	h := assetHarness(t)
	wantStatus(t, h.request(http.MethodGet, "/assets/missing-1234.js", "", nil), http.StatusNotFound)
}

func TestUnbuiltAssetsExplainThemselves(t *testing.T) {
	h := newHarness(t, seedRepo(t), func(o *harnessOptions) { o.assets = fstest.MapFS{".gitkeep": {}} })
	res := h.request(http.MethodGet, "/", "", nil)
	wantStatus(t, res, http.StatusServiceUnavailable)
	if !strings.Contains(readBody(t, res), "web assets are not built") {
		t.Error("the placeholder page does not explain how to build the assets")
	}
}

func TestNonHashedAssetIsNotImmutable(t *testing.T) {
	h := assetHarness(t)
	res := h.request(http.MethodGet, "/favicon.ico", "", nil)
	wantStatus(t, res, http.StatusOK)
	if got := res.Header.Get("Cache-Control"); got == immutableCache {
		t.Error("a file outside assets/ must not be cached immutably")
	}
}

func TestLangFor(t *testing.T) {
	cases := map[string]string{
		"internal/gitx/blob.go": "go",
		"web/src/main.ts":       "typescript",
		"web/src/App.tsx":       "tsx",
		"README.md":             "markdown",
		"Dockerfile":            "dockerfile",
		"deploy/Makefile":       "makefile",
		"config.YAML":           "yaml",
		"noextension":           "",
		"weird.qqq":             "",
	}
	for path, want := range cases {
		if got := langFor(path); got != want {
			t.Errorf("langFor(%q) = %q, want %q", path, got, want)
		}
	}
}
