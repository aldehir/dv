package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/alde/dv/internal/comments"
	"github.com/alde/dv/internal/gitx"
	"github.com/alde/dv/internal/model"
)

const (
	TokenHeader       = "X-Dv-Token"
	LegacyTokenHeader = "Sec-Dv-Token"
	TokenQueryParam   = "token"
	TokenPlaceholder  = "__DV_TOKEN__"

	tokenBytes        = 32
	shutdownGrace     = 5 * time.Second
	manifestTTL       = time.Second
	readHeaderTimeout = 10 * time.Second
	maxWorkers        = 8
)

type Options struct {
	Repo        *gitx.Repo
	Spec        *gitx.RevSpec
	Git         gitx.Options
	Store       *comments.Store
	Assets      fs.FS
	Defaults    model.Defaults
	Token       string
	Host        string
	Port        int
	DevProxy    string
	IdleTimeout time.Duration
	Version     string
	Workers     int
	Logger      *slog.Logger
}

type Server struct {
	opts     Options
	log      *slog.Logger
	head     string
	resolver comments.ContentResolver
	handler  http.Handler
	http     *http.Server

	listener net.Listener
	url      string

	closing   chan struct{}
	closeOnce sync.Once
	activity  *activity

	mu           sync.Mutex
	manifest     *model.Manifest
	manifestTime time.Time
}

func NewToken() (string, error) {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("server: cannot generate a token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func New(o Options) (*Server, error) {
	if o.Repo == nil || o.Spec == nil {
		return nil, errors.New("server: Repo and Spec are required")
	}
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	if o.Workers <= 0 {
		o.Workers = min(max(runtime.NumCPU()/2, 2), maxWorkers)
	}
	head, err := o.Repo.Head()
	if err != nil {
		return nil, err
	}

	s := &Server{
		opts:     o,
		log:      o.Logger,
		head:     head,
		resolver: NewContentResolver(o.Repo, o.Spec),
		closing:  make(chan struct{}),
		activity: newActivity(),
	}
	s.handler = s.routes()
	s.http = &http.Server{
		Handler:           s.handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ErrorLog:          slog.NewLogLogger(o.Logger.Handler(), slog.LevelDebug),
	}
	return s, nil
}

func (s *Server) Handler() http.Handler { return s.handler }

func (s *Server) URL() string { return s.url }

func (s *Server) Listen() (string, error) {
	host, err := bindHost(s.opts.Host)
	if err != nil {
		return "", err
	}
	if isWildcard(host) {
		s.log.Warn("listening on every interface: anyone who can reach this port can read the diff and write comments", "host", host)
	}
	addr := net.JoinHostPort(host, strconv.Itoa(s.opts.Port))
	listener, err := net.Listen("tcp", addr)
	if err != nil && s.opts.Port != 0 {
		s.log.Warn("cannot bind the requested port, falling back to an ephemeral one", "addr", addr, "error", err)
		listener, err = net.Listen("tcp", net.JoinHostPort(host, "0"))
	}
	if err != nil {
		return "", fmt.Errorf("cannot listen on %s: %w", addr, err)
	}
	s.listener = listener
	s.url = "http://" + net.JoinHostPort(browsableHost(host), strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	return s.url, nil
}

func (s *Server) Serve(ctx context.Context) error {
	if s.listener == nil {
		if _, err := s.Listen(); err != nil {
			return err
		}
	}

	served := make(chan error, 1)
	go func() {
		err := s.http.Serve(s.listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		served <- err
	}()

	var serveErr error
	select {
	case serveErr = <-served:
	case <-ctx.Done():
	case <-s.idleExpired(ctx):
		s.log.Info("no clients connected, shutting down", "timeout", s.opts.IdleTimeout)
	}

	s.stopStreams()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	if err := s.http.Shutdown(shutdownCtx); err != nil && serveErr == nil {
		serveErr = err
	}
	return serveErr
}

func (s *Server) stopStreams() {
	s.closeOnce.Do(func() { close(s.closing) })
}

func (s *Server) Manifest() (*model.Manifest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.manifest != nil && time.Since(s.manifestTime) < manifestTTL {
		return s.manifest, nil
	}
	m, err := s.opts.Repo.Manifest(s.opts.Spec, s.opts.Git)
	if err != nil {
		return nil, err
	}
	s.manifest = m
	s.manifestTime = time.Now()
	return m, nil
}

func (s *Server) cachedManifest() (*model.Manifest, error) {
	s.mu.Lock()
	cached := s.manifest
	s.mu.Unlock()
	if cached != nil {
		return cached, nil
	}
	return s.Manifest()
}

func (s *Server) workers() int { return s.opts.Workers }

func bindHost(host string) (string, error) {
	switch host {
	case "":
		return "127.0.0.1", nil
	case "localhost":
		return host, nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !(ip.IsLoopback() || ip.IsUnspecified()) {
		return "", fmt.Errorf("host %q is neither loopback nor a wildcard: dv listens on a loopback address, 0.0.0.0, or ::", host)
	}
	return host, nil
}

func isWildcard(host string) bool {
	ip := net.ParseIP(host)
	return ip != nil && ip.IsUnspecified()
}

func browsableHost(host string) string {
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsUnspecified() {
		return host
	}
	if ip.To4() != nil {
		return "127.0.0.1"
	}
	return "::1"
}
