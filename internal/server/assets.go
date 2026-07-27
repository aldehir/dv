package server

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"strconv"
	"strings"
)

const (
	indexFile      = "index.html"
	immutableCache = "public, max-age=31536000, immutable"
	notBuiltNotice = "dv: the web assets are not built.\nRun `make web` (or `cd web && bun run build`) and start dv again.\n"
)

type encoding struct {
	token  string
	suffix string
}

var encodings = []encoding{
	{token: "br", suffix: ".br"},
	{token: "gzip", suffix: ".gz"},
}

type assetHandler struct {
	fsys  fs.FS
	token string
	proxy http.Handler
}

func (s *Server) newAssetHandler() http.Handler {
	h := &assetHandler{fsys: s.opts.Assets, token: s.opts.Token}
	if s.opts.DevProxy != "" {
		target, err := url.Parse(s.opts.DevProxy)
		if err != nil || target.Host == "" {
			s.log.Error("ignoring an unusable --dev-proxy target", "target", s.opts.DevProxy, "error", err)
		} else {
			s.log.Info("proxying assets to the dev server", "target", target.String())
			h.proxy = h.newProxy(target)
		}
	}
	return h
}

func (h *assetHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.proxy != nil {
		h.proxy.ServeHTTP(w, r)
		return
	}

	name := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if name == "." || name == "/" || name == "" {
		name = indexFile
	}
	if strings.HasPrefix(name, "..") {
		http.NotFound(w, r)
		return
	}
	if strings.HasSuffix(name, ".br") || strings.HasSuffix(name, ".gz") {
		http.NotFound(w, r)
		return
	}
	if name == indexFile {
		h.serveIndex(w, r)
		return
	}

	body, enc, err := h.read(name, r.Header.Get("Accept-Encoding"))
	if err != nil {
		if path.Ext(name) == "" {
			h.serveIndex(w, r)
			return
		}
		http.NotFound(w, r)
		return
	}

	header := w.Header()
	header.Set("Vary", "Accept-Encoding")
	if enc != "" {
		header.Set("Content-Encoding", enc)
	}
	header.Set("Content-Type", contentType(name))
	header.Set("Cache-Control", cacheControl(name))
	header.Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.Write(body)
}

func (h *assetHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	header := w.Header()
	header.Set("Cache-Control", "no-store")
	header.Set("Vary", "Accept-Encoding")

	raw, err := h.readFile(indexFile)
	if err != nil {
		header.Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(notBuiltNotice))
		return
	}
	body := bytes.ReplaceAll(raw, []byte(TokenPlaceholder), []byte(h.token))
	header.Set("Content-Type", "text/html; charset=utf-8")
	header.Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.Write(body)
}

func (h *assetHandler) read(name, acceptEncoding string) ([]byte, string, error) {
	for _, candidate := range encodings {
		if !acceptsEncoding(acceptEncoding, candidate.token) {
			continue
		}
		if body, err := h.readFile(name + candidate.suffix); err == nil {
			return body, candidate.token, nil
		}
	}
	body, err := h.readFile(name)
	return body, "", err
}

func (h *assetHandler) readFile(name string) ([]byte, error) {
	if h.fsys == nil {
		return nil, fs.ErrNotExist
	}
	return fs.ReadFile(h.fsys, name)
}

func acceptsEncoding(header, want string) bool {
	for field := range strings.SplitSeq(header, ",") {
		token, params, _ := strings.Cut(strings.TrimSpace(field), ";")
		if !strings.EqualFold(strings.TrimSpace(token), want) {
			continue
		}
		return !strings.Contains(strings.ReplaceAll(params, " ", ""), "q=0")
	}
	return false
}

func contentType(name string) string {
	if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func cacheControl(name string) string {
	if strings.HasPrefix(name, "assets/") {
		return immutableCache
	}
	return "no-cache"
}

func (h *assetHandler) newProxy(target *url.URL) http.Handler {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Host = target.Host
		},
		ModifyResponse: h.injectToken,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			writeError(w, http.StatusBadGateway, "the dev server is unreachable", err.Error())
		},
	}
	return proxy
}

func (h *assetHandler) injectToken(res *http.Response) error {
	if !strings.Contains(res.Header.Get("Content-Type"), "text/html") {
		return nil
	}
	if res.Header.Get("Content-Encoding") != "" {
		return errors.New("dev server sent compressed html, cannot inject the dv token")
	}
	raw, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil {
		return err
	}
	body := bytes.ReplaceAll(raw, []byte(TokenPlaceholder), []byte(h.token))
	res.Body = io.NopCloser(bytes.NewReader(body))
	res.ContentLength = int64(len(body))
	res.Header.Set("Content-Length", strconv.Itoa(len(body)))
	res.Header.Set("Cache-Control", "no-store")
	return nil
}
