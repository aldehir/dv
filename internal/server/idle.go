package server

import (
	"context"
	"sync"
	"time"
)

const (
	minIdleInterval = 10 * time.Millisecond
	maxIdleInterval = 30 * time.Second
)

type activity struct {
	mu      sync.Mutex
	clients int
	last    time.Time
}

func newActivity() *activity {
	return &activity{last: time.Now()}
}

func (a *activity) touch() {
	a.mu.Lock()
	a.last = time.Now()
	a.mu.Unlock()
}

func (a *activity) open() func() {
	a.mu.Lock()
	a.clients++
	a.last = time.Now()
	a.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			a.mu.Lock()
			a.clients--
			a.last = time.Now()
			a.mu.Unlock()
		})
	}
}

func (a *activity) clientCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.clients
}

func (a *activity) idleFor(timeout time.Duration) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.clients > 0 {
		return false
	}
	return time.Since(a.last) >= timeout
}

func (s *Server) idleExpired(ctx context.Context) <-chan struct{} {
	timeout := s.opts.IdleTimeout
	if timeout <= 0 {
		return nil
	}
	out := make(chan struct{})
	go func() {
		ticker := time.NewTicker(idleInterval(timeout))
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.closing:
				return
			case <-ticker.C:
				if s.activity.idleFor(timeout) {
					close(out)
					return
				}
			}
		}
	}()
	return out
}

func idleInterval(timeout time.Duration) time.Duration {
	interval := timeout / 4
	if interval < minIdleInterval {
		return minIdleInterval
	}
	if interval > maxIdleInterval {
		return maxIdleInterval
	}
	return interval
}
