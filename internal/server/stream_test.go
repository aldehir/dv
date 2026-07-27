package server

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alde/dv/internal/model"
)

type sseEvent struct {
	Name string
	Data string
}

func readEvents(t *testing.T, res *http.Response, want int, stop func(sseEvent) bool) []sseEvent {
	t.Helper()
	events := make([]sseEvent, 0, want)
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 8<<20)

	current := sseEvent{}
	var data strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			current.Name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimPrefix(line, "data: "))
		case line == "":
			if current.Name == "" && data.Len() == 0 {
				continue
			}
			current.Data = data.String()
			events = append(events, current)
			if len(events) >= want || (stop != nil && stop(current)) {
				return events
			}
			current = sseEvent{}
			data.Reset()
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("read sse: %v", err)
	}
	return events
}

func TestDiffStreamSendsManifestFirst(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	res := h.get("/api/stream")
	wantStatus(t, res, http.StatusOK)

	if got := res.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Errorf("Content-Type = %q, want text/event-stream", got)
	}
	if got := res.Header.Get("Cache-Control"); !strings.Contains(got, "no-cache") {
		t.Errorf("Cache-Control = %q, want it to contain no-cache", got)
	}
	if got := res.Header.Get("X-Accel-Buffering"); got != "no" {
		t.Errorf("X-Accel-Buffering = %q, want no", got)
	}

	events := readEvents(t, res, 5, func(e sseEvent) bool { return e.Name == "done" })
	if len(events) == 0 {
		t.Fatal("no events arrived")
	}
	if events[0].Name != "manifest" {
		t.Fatalf("first event is %q, want manifest", events[0].Name)
	}

	var manifest model.Manifest
	if err := json.Unmarshal([]byte(events[0].Data), &manifest); err != nil {
		t.Fatalf("unmarshal manifest: %v", err)
	}
	if manifest.Totals.Files != 3 {
		t.Errorf("manifest lists %d files, want 3", manifest.Totals.Files)
	}

	seen := map[string]bool{}
	for _, e := range events[1:] {
		if e.Name != "file" {
			continue
		}
		var payload model.FilePayload
		if err := json.Unmarshal([]byte(e.Data), &payload); err != nil {
			t.Fatalf("unmarshal file payload: %v", err)
		}
		if payload.Patch == "" {
			t.Errorf("%s arrived with an empty patch", payload.Path)
		}
		seen[payload.Path] = true
	}
	for _, path := range []string{"docs/guide.md", "src/app.go", "src/legacy.go"} {
		if !seen[path] {
			t.Errorf("%s never arrived on the stream", path)
		}
	}
	if events[len(events)-1].Name != "done" {
		t.Errorf("last event is %q, want done", events[len(events)-1].Name)
	}
}

func TestDiffStreamCountsAsAClient(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	res := h.get("/api/stream")
	wantStatus(t, res, http.StatusOK)
	readEvents(t, res, 1, nil)

	deadline := time.Now().Add(2 * time.Second)
	for h.server.activity.clientCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if h.server.activity.clientCount() == 0 {
		t.Fatal("an open stream did not register as a connected client")
	}
	if h.server.activity.idleFor(0) {
		t.Error("the server counted itself idle while a stream was open")
	}

	res.Body.Close()
	for h.server.activity.clientCount() > 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if got := h.server.activity.clientCount(); got != 0 {
		t.Errorf("clientCount = %d after the stream closed, want 0", got)
	}
}

func TestCommentsStreamPushesExternalWrites(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	created := createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":1,"endLine":1},"body":"look here"}`)

	res := h.get("/api/comments/stream")
	wantStatus(t, res, http.StatusOK)

	first := readEvents(t, res, 1, nil)
	if len(first) != 1 || first[0].Name != "comments" {
		t.Fatalf("first event = %+v, want a comments event", first)
	}
	var initial commentsResponse
	if err := json.Unmarshal([]byte(first[0].Data), &initial); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(initial.Doc.Comments) != 1 {
		t.Fatalf("initial push carried %d comments, want 1", len(initial.Doc.Comments))
	}

	go func() {
		time.Sleep(150 * time.Millisecond)
		raw, err := os.ReadFile(h.commentsPath())
		if err != nil {
			return
		}
		var doc model.CommentsDoc
		if json.Unmarshal(raw, &doc) != nil {
			return
		}
		doc.Comments[0].Replies = append(doc.Comments[0].Replies, model.Reply{
			ID:        "rpl_external",
			Author:    model.Author{Name: "agent"},
			CreatedAt: "2026-07-26T00:00:00Z",
			Body:      "changed it",
		})
		rewritten, err := json.MarshalIndent(&doc, "", "  ")
		if err != nil {
			return
		}
		os.WriteFile(h.commentsPath(), rewritten, 0o644)
	}()

	next := readEvents(t, res, 1, nil)
	if len(next) != 1 {
		t.Fatalf("no event followed the external write")
	}
	var pushed commentsResponse
	if err := json.Unmarshal([]byte(next[0].Data), &pushed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(pushed.Doc.Comments) != 1 {
		t.Fatalf("pushed %d comments, want 1", len(pushed.Doc.Comments))
	}
	if pushed.Doc.Comments[0].ID != created.ID {
		t.Errorf("pushed comment id = %q, want %q", pushed.Doc.Comments[0].ID, created.ID)
	}
	if len(pushed.Doc.Comments[0].Replies) != 1 {
		t.Fatalf("pushed comment has %d replies, want the externally written one", len(pushed.Doc.Comments[0].Replies))
	}
	if pushed.Doc.Comments[0].Replies[0].Body != "changed it" {
		t.Errorf("reply body = %q, want the externally written one", pushed.Doc.Comments[0].Replies[0].Body)
	}
}
