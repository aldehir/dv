package comments

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alde/dv/internal/model"
)

func agentWrite(t *testing.T, s *Store, comments ...model.Comment) {
	t.Helper()
	doc := &model.CommentsDoc{
		Version:   model.SchemaVersion,
		Generator: "agent/1.0",
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Comments:  comments,
	}
	raw, err := serialize(doc)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	tmp := filepath.Join(filepath.Dir(s.Path()), "agent-staging.json")
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.Rename(tmp, s.Path()); err != nil {
		t.Fatalf("rename: %v", err)
	}
}

func expectPush(t *testing.T, ch <-chan struct{}, why string) {
	t.Helper()
	select {
	case _, ok := <-ch:
		if !ok {
			t.Fatalf("watch channel closed while waiting for %s", why)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("no push for %s", why)
	}
}

func expectNoPush(t *testing.T, ch <-chan struct{}, why string) {
	t.Helper()
	select {
	case <-ch:
		t.Fatalf("unexpected push for %s", why)
	case <-time.After(10 * WatchDebounce):
	}
}

func TestWatchPushesOnAnExternalWrite(t *testing.T) {
	s := newTestStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}

	agentWrite(t, s, model.Comment{
		ID:        "cmt_agent",
		Author:    model.Author{Name: "agent"},
		CreatedAt: "2026-07-26T18:00:00Z",
		Body:      "landed the fix",
		Anchor: model.Anchor{
			Path: "a.go", Side: model.SideAdditions, StartLine: 1, EndLine: 1, Quote: "x\n",
		},
	})
	expectPush(t, ch, "the agent's atomic rewrite")

	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(doc.Comments) != 1 || doc.Comments[0].ID != "cmt_agent" {
		t.Fatalf("comments = %#v", doc.Comments)
	}

	agentWrite(t, s)
	expectPush(t, ch, "the agent's second rewrite")

	if err := os.Remove(s.Path()); err != nil {
		t.Fatalf("remove: %v", err)
	}
	expectPush(t, ch, "the file being deleted")
}

func TestWatchIgnoresTheStoresOwnWrites(t *testing.T) {
	s := newTestStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}

	mustAdd(t, s, anchorAt("a.go", 1, 1), "written through the store")
	expectNoPush(t, ch, "the store's own write")

	agentWrite(t, s)
	expectPush(t, ch, "an external write after our own")
}

func TestWatchStopsWhenTheContextIsCancelled(t *testing.T) {
	s := newTestStore(t)
	ctx, cancel := context.WithCancel(context.Background())

	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}
	cancel()

	select {
	case _, ok := <-ch:
		if ok {
			t.Fatal("expected the channel to be closed, got a push")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the watch channel was not closed on cancel")
	}
}

func TestWatchCoalescesABurstOfWrites(t *testing.T) {
	s := newTestStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}

	for i := range 20 {
		agentWrite(t, s, model.Comment{
			ID:        "cmt_burst",
			Author:    model.Author{Name: "agent"},
			CreatedAt: "2026-07-26T18:00:00Z",
			Body:      "burst " + strings.Repeat("!", i),
			Anchor: model.Anchor{
				Path: "a.go", Side: model.SideAdditions, StartLine: 1, EndLine: 1, Quote: "x\n",
			},
		})
	}
	expectPush(t, ch, "the burst")

	pushes := 0
	deadline := time.After(20 * WatchDebounce)
drain:
	for {
		select {
		case <-ch:
			pushes++
		case <-deadline:
			break drain
		}
	}
	if pushes > 2 {
		t.Errorf("burst produced %d extra pushes, want it coalesced", pushes)
	}
	expectNoPush(t, ch, "a settled file")
}
