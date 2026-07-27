package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

const sseHeartbeat = 15 * time.Second

type sseStream struct {
	w  http.ResponseWriter
	rc *http.ResponseController
}

func openSSE(w http.ResponseWriter) (*sseStream, error) {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	s := &sseStream{w: w, rc: http.NewResponseController(w)}
	return s, s.flush()
}

func (s *sseStream) flush() error {
	err := s.rc.Flush()
	if errors.Is(err, http.ErrNotSupported) {
		return nil
	}
	return err
}

func (s *sseStream) event(name string, data []byte) error {
	var buf bytes.Buffer
	if name != "" {
		buf.WriteString("event: ")
		buf.WriteString(name)
		buf.WriteByte('\n')
	}
	for line := range bytes.SplitSeq(data, []byte("\n")) {
		buf.WriteString("data: ")
		buf.Write(line)
		buf.WriteByte('\n')
	}
	buf.WriteByte('\n')
	if _, err := s.w.Write(buf.Bytes()); err != nil {
		return err
	}
	return s.flush()
}

func (s *sseStream) json(name string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return s.event(name, raw)
}

func (s *sseStream) ping() error {
	if _, err := s.w.Write([]byte(": ping\n\n")); err != nil {
		return err
	}
	return s.flush()
}
