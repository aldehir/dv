package server

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/alde/dv/internal/model"
)

type fileResult struct {
	entry   model.FileEntry
	payload *model.FilePayload
	err     error
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	release := s.activity.open()
	defer release()

	stream, err := openSSE(w)
	if err != nil {
		s.log.Debug("cannot start the diff stream", "error", err)
		return
	}

	manifest, err := s.Manifest()
	if err != nil {
		_, message := classify(err)
		stream.json("fatal", model.Error{Error: message, Detail: err.Error()})
		return
	}
	if err := stream.json("manifest", manifest); err != nil {
		return
	}

	ctx := r.Context()
	results := s.streamFiles(ctx, manifest)
	heartbeat := time.NewTicker(sseHeartbeat)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.closing:
			return
		case <-heartbeat.C:
			if err := stream.ping(); err != nil {
				return
			}
		case res, ok := <-results:
			if !ok {
				stream.json("done", model.Totals{
					Files:     manifest.Totals.Files,
					Additions: manifest.Totals.Additions,
					Deletions: manifest.Totals.Deletions,
				})
				return
			}
			if res.err != nil {
				_, message := classify(res.err)
				s.log.Warn("cannot build a file payload", "path", res.entry.Path, "error", res.err)
				if err := stream.json("file-error", map[string]string{"id": res.entry.ID, "path": res.entry.Path, "error": message}); err != nil {
					return
				}
				continue
			}
			if err := stream.json("file", res.payload); err != nil {
				return
			}
		}
	}
}

func (s *Server) streamFiles(ctx context.Context, manifest *model.Manifest) <-chan fileResult {
	results := make(chan fileResult)
	jobs := make(chan model.FileEntry)

	var wg sync.WaitGroup
	for range s.workers() {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for entry := range jobs {
				payload, err := s.opts.Repo.File(s.opts.Spec, entry, s.opts.Git)
				select {
				case results <- fileResult{entry: entry, payload: payload, err: err}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, entry := range manifest.Files {
			select {
			case jobs <- entry:
			case <-ctx.Done():
				return
			case <-s.closing:
				return
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	return results
}
