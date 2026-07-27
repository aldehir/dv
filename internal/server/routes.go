package server

import (
	"crypto/subtle"
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) routes() http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("GET /api/session", s.handleSession)
	api.HandleFunc("GET /api/manifest", s.handleManifest)
	api.HandleFunc("GET /api/file/{id}", s.handleFile)
	api.HandleFunc("GET /api/stream", s.handleStream)
	api.HandleFunc("GET /api/comments", s.handleCommentsList)
	api.HandleFunc("POST /api/comments", s.handleCommentsCreate)
	api.HandleFunc("PATCH /api/comments/{id}", s.handleCommentsUpdate)
	api.HandleFunc("DELETE /api/comments/{id}", s.handleCommentsDelete)
	api.HandleFunc("POST /api/comments/{id}/replies", s.handleCommentsReply)
	api.HandleFunc("GET /api/comments/stream", s.handleCommentsStream)

	root := http.NewServeMux()
	root.Handle("/api/", s.guardToken(api))
	root.HandleFunc("GET /healthz", s.handleHealth)
	root.Handle("/", s.newAssetHandler())

	return s.secureHeaders(s.checkOrigin(s.trackActivity(root)))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": s.opts.Version})
}

func (s *Server) trackActivity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.activity.touch()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) checkOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && !sameOrigin(origin, r.Host) {
			s.log.Warn("rejected a cross-origin request", "origin", origin, "path", r.URL.Path)
			writeError(w, http.StatusForbidden, "cross-origin request rejected", "dv only answers requests from its own page")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sameOrigin(origin, host string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	if parsed.Host == host {
		return true
	}
	originHost, originPort := splitHostPort(parsed.Host)
	wantHost, wantPort := splitHostPort(host)
	if originPort != wantPort {
		return false
	}
	return isLoopbackName(originHost) && isLoopbackName(wantHost)
}

func splitHostPort(hostport string) (host, port string) {
	host = hostport
	if i := strings.LastIndexByte(hostport, ':'); i >= 0 && !strings.Contains(hostport[i:], "]") {
		host, port = hostport[:i], hostport[i+1:]
	}
	return strings.Trim(host, "[]"), port
}

func isLoopbackName(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return strings.HasPrefix(host, "127.")
}

func (s *Server) guardToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.tokenOK(r) {
			writeError(w, http.StatusForbidden, "missing or invalid token", "send the dv token in the "+TokenHeader+" header or as ?"+TokenQueryParam+"=")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) tokenOK(r *http.Request) bool {
	want := s.opts.Token
	if want == "" {
		return true
	}
	got := r.Header.Get(TokenHeader)
	if got == "" {
		got = r.URL.Query().Get(TokenQueryParam)
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}
