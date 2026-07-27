package server

import (
	"net/http"
	"net/url"
	"testing"
	"testing/fstest"
	"time"
)

func TestTokenGuard(t *testing.T) {
	assets := fstest.MapFS{
		"index.html": {Data: []byte(`<meta name="dv-token" content="` + TokenPlaceholder + `">`)},
	}
	h := newHarness(t, seedRepo(t), func(o *harnessOptions) { o.assets = assets })

	cases := []struct {
		name    string
		path    string
		headers map[string]string
		want    int
	}{
		{"missing token", "/api/manifest", map[string]string{TokenHeader: ""}, http.StatusForbidden},
		{"wrong token", "/api/manifest", map[string]string{TokenHeader: "nope"}, http.StatusForbidden},
		{"header token", "/api/manifest", nil, http.StatusOK},
		{"query token", "/api/manifest?token=" + url.QueryEscape(fixtureToken), map[string]string{TokenHeader: ""}, http.StatusOK},
		{"wrong query token", "/api/manifest?token=nope", map[string]string{TokenHeader: ""}, http.StatusForbidden},
		{"healthz is exempt", "/healthz", map[string]string{TokenHeader: ""}, http.StatusOK},
		{"assets are exempt", "/", map[string]string{TokenHeader: ""}, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := h.request(http.MethodGet, tc.path, "", tc.headers)
			wantStatus(t, res, tc.want)
		})
	}
}

func TestOriginGuard(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	ours, err := url.Parse(h.http.URL)
	if err != nil {
		t.Fatalf("parse test server url: %v", err)
	}

	cases := []struct {
		name   string
		origin string
		want   int
	}{
		{"no origin", "", http.StatusOK},
		{"own origin", h.http.URL, http.StatusOK},
		{"loopback alias", "http://localhost:" + ours.Port(), http.StatusOK},
		{"another site", "http://evil.example", http.StatusForbidden},
		{"another port", "http://127.0.0.1:1", http.StatusForbidden},
		{"null origin", "null", http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := h.request(http.MethodGet, "/api/session", "", map[string]string{"Origin": tc.origin})
			wantStatus(t, res, tc.want)
		})
	}
}

func TestNewTokenIsUnique(t *testing.T) {
	first, err := NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	second, err := NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	if first == second {
		t.Error("two tokens are identical")
	}
	if len(first) < 40 {
		t.Errorf("token %q is only %d characters long", first, len(first))
	}
}

func TestBindHost(t *testing.T) {
	cases := []struct {
		host      string
		want      string
		browsable string
		ok        bool
	}{
		{"", "127.0.0.1", "127.0.0.1", true},
		{"localhost", "localhost", "localhost", true},
		{"127.0.0.1", "127.0.0.1", "127.0.0.1", true},
		{"127.0.0.53", "127.0.0.53", "127.0.0.53", true},
		{"::1", "::1", "::1", true},
		{"0.0.0.0", "0.0.0.0", "127.0.0.1", true},
		{"::", "::", "::1", true},
		{"192.168.1.5", "", "", false},
		{"example.com", "", "", false},
	}
	for _, tc := range cases {
		got, err := bindHost(tc.host)
		if tc.ok != (err == nil) {
			t.Errorf("bindHost(%q) error = %v, want ok=%v", tc.host, err, tc.ok)
			continue
		}
		if !tc.ok {
			continue
		}
		if got != tc.want {
			t.Errorf("bindHost(%q) = %q, want %q", tc.host, got, tc.want)
		}
		if browsable := browsableHost(got); browsable != tc.browsable {
			t.Errorf("browsableHost(%q) = %q, want %q", got, browsable, tc.browsable)
		}
	}
}

func TestActivityBlocksIdleWhileClientsConnected(t *testing.T) {
	a := newActivity()
	if !a.idleFor(0) {
		t.Error("a brand new tracker with no clients should count as idle at timeout 0")
	}
	release := a.open()
	if a.clientCount() != 1 {
		t.Errorf("clientCount = %d, want 1", a.clientCount())
	}
	if a.idleFor(0) {
		t.Error("idleFor reported idle while a client is connected")
	}
	release()
	release()
	if a.clientCount() != 0 {
		t.Errorf("clientCount = %d after a double release, want 0", a.clientCount())
	}
	if !a.idleFor(0) {
		t.Error("idleFor should report idle once the last client is gone")
	}
	if a.idleFor(time.Hour) {
		t.Error("idleFor(1h) reported idle immediately after activity")
	}
}
