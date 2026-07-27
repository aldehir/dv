package comments

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/fsnotify/fsnotify"
)

const WatchDebounce = 80 * time.Millisecond

func (s *Store) Watch(ctx context.Context) (<-chan struct{}, error) {
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, dirPerm); err != nil {
		return nil, err
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := w.Add(dir); err != nil {
		w.Close()
		return nil, err
	}
	out := make(chan struct{}, 1)
	go s.watchLoop(ctx, w, out)
	return out, nil
}

func (s *Store) watchLoop(ctx context.Context, w *fsnotify.Watcher, out chan struct{}) {
	defer close(out)
	defer w.Close()

	base := filepath.Base(s.path)
	timer := time.NewTimer(WatchDebounce)
	if !timer.Stop() {
		<-timer.C
	}
	defer timer.Stop()
	pending := false

	for {
		select {
		case <-ctx.Done():
			return

		case err, ok := <-w.Errors:
			if !ok {
				return
			}
			s.log.Warn("comments watcher error", "path", s.path, "error", err)

		case ev, ok := <-w.Events:
			if !ok {
				return
			}
			if filepath.Base(ev.Name) != base {
				continue
			}
			if ev.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Rename|fsnotify.Remove) == 0 {
				continue
			}
			if pending && !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(WatchDebounce)
			pending = true

		case <-timer.C:
			pending = false
			if !s.changedOnDisk() {
				continue
			}
			select {
			case out <- struct{}{}:
			default:
			}
		}
	}
}

func (s *Store) changedOnDisk() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	var etag string
	if raw, err := os.ReadFile(s.path); err == nil {
		etag = etagOf(raw)
	}
	if etag == s.lastSeen {
		return false
	}
	s.lastSeen = etag
	return true
}
