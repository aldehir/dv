package comments

import (
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alde/dv/internal/model"
)

var baseTime = time.Date(2026, 7, 26, 18, 0, 0, 0, time.UTC)

func advancingClock() func() time.Time {
	var mu sync.Mutex
	n := 0
	return func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		n++
		return baseTime.Add(time.Duration(n) * time.Second)
	}
}

func testConfig(t *testing.T) Config {
	t.Helper()
	dir := t.TempDir()
	return Config{
		Path: filepath.Join(dir, DefaultFileName),
		Repo: model.RepoRef{Root: dir, Head: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"},
		Spec: model.Spec{
			Kind:  model.SpecTwoDot,
			Left:  "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
			Right: "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70819203",
			Argv:  []string{"main", "feature"},
		},
		Generator: "dv/0.1.0",
		Author:    model.Author{Name: "Alde Rojas", Email: "alde@example.com"},
		Logger:    slog.New(slog.DiscardHandler),
		Now:       advancingClock(),
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

func anchorAt(path string, start, end int) model.Anchor {
	return model.Anchor{
		Path:      path,
		Side:      model.SideAdditions,
		StartLine: start,
		EndLine:   end,
		BlobSha:   "deadbeef",
		Lang:      "go",
		Quote:     "line one\nline two\n",
	}
}

func mustAdd(t *testing.T, s *Store, a model.Anchor, body string) *model.Comment {
	t.Helper()
	c, _, err := s.Add(a, body)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	return c
}

func TestLoadMissingFileReturnsFreshDoc(t *testing.T) {
	s := newTestStore(t)

	doc, etag, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if doc.Version != model.SchemaVersion {
		t.Errorf("version = %d, want %d", doc.Version, model.SchemaVersion)
	}
	if doc.Generator != "dv/0.1.0" {
		t.Errorf("generator = %q", doc.Generator)
	}
	if doc.Spec.Kind != model.SpecTwoDot {
		t.Errorf("spec kind = %q", doc.Spec.Kind)
	}
	if doc.Comments == nil || len(doc.Comments) != 0 {
		t.Errorf("comments = %#v, want empty non-nil", doc.Comments)
	}
	if len(etag) != etagLength {
		t.Errorf("etag = %q, want %d chars", etag, etagLength)
	}
	if s.Exists() {
		t.Error("Load created the file; it must not")
	}
	if r := s.Report(); r.Quarantined() || len(r.Issues) != 0 {
		t.Errorf("report = %#v, want empty", r)
	}
}

func TestAddPersistsAndOrdersStably(t *testing.T) {
	s := newTestStore(t)

	mustAdd(t, s, anchorAt("web/src/main.ts", 9, 9), "third")
	mustAdd(t, s, anchorAt("internal/gitx/blob.go", 90, 91), "second")
	mustAdd(t, s, anchorAt("internal/gitx/blob.go", 42, 47), "first")

	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	var got []string
	for _, c := range doc.Comments {
		got = append(got, c.Body)
	}
	want := []string{"first", "second", "third"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("order = %v, want %v", got, want)
	}
	for _, c := range doc.Comments {
		if !strings.HasPrefix(c.ID, commentIDPrefix) {
			t.Errorf("id %q lacks prefix %q", c.ID, commentIDPrefix)
		}
		if len(c.ID) != len(commentIDPrefix)+26 {
			t.Errorf("id %q has length %d, want %d", c.ID, len(c.ID), len(commentIDPrefix)+26)
		}
		if c.Author.Name != "Alde Rojas" {
			t.Errorf("author = %#v", c.Author)
		}
		if c.Replies == nil {
			t.Error("replies must serialize as an array, not null")
		}
	}
}

func TestAddRejectsBadInput(t *testing.T) {
	s := newTestStore(t)

	cases := map[string]struct {
		anchor model.Anchor
		body   string
	}{
		"empty body":    {anchorAt("a.go", 1, 1), "   \n"},
		"no path":       {model.Anchor{Side: model.SideAdditions, StartLine: 1, EndLine: 1}, "body"},
		"bad side":      {model.Anchor{Path: "a.go", Side: "middle", StartLine: 1, EndLine: 1}, "body"},
		"negative line": {model.Anchor{Path: "a.go", Side: model.SideAdditions, StartLine: -1, EndLine: -1}, "body"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if _, _, err := s.Add(tc.anchor, tc.body); !errors.Is(err, ErrInvalid) {
				t.Fatalf("err = %v, want ErrInvalid", err)
			}
		})
	}
	if s.Exists() {
		t.Error("rejected input must not create the file")
	}
}

func TestAddNormalizesInvertedRange(t *testing.T) {
	s := newTestStore(t)
	c := mustAdd(t, s, anchorAt("a.go", 10, 4), "body")
	if c.Anchor.EndLine != 10 {
		t.Errorf("endLine = %d, want 10", c.Anchor.EndLine)
	}
}

func TestFirstWriteHintFiresOnce(t *testing.T) {
	cfg := testConfig(t)
	var hints []string
	cfg.OnFirstWrite = func(path string) { hints = append(hints, path) }
	s, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if s.Exists() {
		t.Fatal("file exists before any write")
	}

	mustAdd(t, s, anchorAt("a.go", 1, 1), "one")
	mustAdd(t, s, anchorAt("a.go", 2, 2), "two")

	if len(hints) != 1 || hints[0] != s.Path() {
		t.Fatalf("hints = %v, want exactly [%s]", hints, s.Path())
	}
	if !s.Exists() {
		t.Error("file should exist after a write")
	}
}

func TestConcurrentWriteConflicts(t *testing.T) {
	s := newTestStore(t)
	c := mustAdd(t, s, anchorAt("a.go", 1, 1), "original")

	_, shared, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	body := "written by the agent"
	_, next, err := s.Update(c.ID, &body, shared)
	if err != nil {
		t.Fatalf("first Update: %v", err)
	}
	if next == shared {
		t.Fatal("etag did not change after a write")
	}

	other := "written by the UI"
	if _, _, err := s.Update(c.ID, &other, shared); !errors.Is(err, ErrConflict) {
		t.Fatalf("second Update err = %v, want ErrConflict", err)
	}

	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if doc.Comments[0].Body != body {
		t.Errorf("body = %q, want the first writer's %q", doc.Comments[0].Body, body)
	}
}

func TestIfMatchForms(t *testing.T) {
	forms := map[string]func(etag string) string{
		"empty means do not check": func(string) string { return "" },
		"wildcard":                 func(string) string { return "*" },
		"bare":                     func(e string) string { return e },
		"quoted":                   func(e string) string { return `"` + e + `"` },
		"weak":                     func(e string) string { return `W/"` + e + `"` },
		"list":                     func(e string) string { return `"nope", "` + e + `"` },
	}
	for name, form := range forms {
		t.Run(name, func(t *testing.T) {
			s := newTestStore(t)
			c := mustAdd(t, s, anchorAt("a.go", 1, 1), "original")
			_, etag, err := s.Load()
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			body := "revised"
			if _, _, err := s.Update(c.ID, &body, form(etag)); err != nil {
				t.Fatalf("Update with If-Match %q: %v", form(etag), err)
			}
		})
	}

	s := newTestStore(t)
	c := mustAdd(t, s, anchorAt("a.go", 1, 1), "original")
	if _, _, err := s.Update(c.ID, nil, "0123456789abcdef0123456789abcdef"); !errors.Is(err, ErrConflict) {
		t.Fatalf("err = %v, want ErrConflict", err)
	}
}

func TestUpdateCannotMutateOwnedFields(t *testing.T) {
	s := newTestStore(t)
	created := mustAdd(t, s, anchorAt("internal/gitx/blob.go", 42, 47), "original body")

	body := "revised body"
	updated, _, err := s.Update(created.ID, &body, "")
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	if updated.ID != created.ID {
		t.Errorf("id changed: %q -> %q", created.ID, updated.ID)
	}
	if updated.CreatedAt != created.CreatedAt {
		t.Errorf("createdAt changed: %q -> %q", created.CreatedAt, updated.CreatedAt)
	}
	if updated.Author != created.Author {
		t.Errorf("author changed: %#v -> %#v", created.Author, updated.Author)
	}
	if updated.Anchor.Path != created.Anchor.Path ||
		updated.Anchor.StartLine != created.Anchor.StartLine ||
		updated.Anchor.EndLine != created.Anchor.EndLine ||
		updated.Anchor.BlobSha != created.Anchor.BlobSha ||
		updated.Anchor.Quote != created.Anchor.Quote ||
		updated.Anchor.Side != created.Anchor.Side {
		t.Errorf("anchor changed: %#v -> %#v", created.Anchor, updated.Anchor)
	}
	if updated.Body != body {
		t.Errorf("the body did not take: %#v", updated)
	}
	if updated.UpdatedAt == created.UpdatedAt {
		t.Error("updatedAt should advance on a change")
	}

	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if doc.Comments[0].ID != created.ID || doc.Comments[0].CreatedAt != created.CreatedAt {
		t.Errorf("on-disk owned fields changed: %#v", doc.Comments[0])
	}
}

func TestUpdateRejectsEmptyBody(t *testing.T) {
	s := newTestStore(t)
	c := mustAdd(t, s, anchorAt("a.go", 1, 1), "body")

	blank := "  "
	if _, _, err := s.Update(c.ID, &blank, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("body err = %v, want ErrInvalid", err)
	}
	if _, _, err := s.Update("cmt_nope", &blank, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing id err = %v, want ErrNotFound", err)
	}
}

func TestDelete(t *testing.T) {
	s := newTestStore(t)
	keep := mustAdd(t, s, anchorAt("a.go", 1, 1), "keep")
	drop := mustAdd(t, s, anchorAt("b.go", 1, 1), "drop")

	if _, err := s.Delete(drop.ID, ""); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := s.Delete(drop.ID, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second Delete err = %v, want ErrNotFound", err)
	}

	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(doc.Comments) != 1 || doc.Comments[0].ID != keep.ID {
		t.Fatalf("comments = %#v", doc.Comments)
	}
}

func TestAddReply(t *testing.T) {
	s := newTestStore(t)
	c := mustAdd(t, s, anchorAt("a.go", 1, 1), "body")

	reply, _, err := s.AddReply(c.ID, "Fixed in 3f1a.\n", model.Author{Name: "agent"}, "")
	if err != nil {
		t.Fatalf("AddReply: %v", err)
	}
	if !strings.HasPrefix(reply.ID, replyIDPrefix) {
		t.Errorf("reply id = %q", reply.ID)
	}
	if reply.Author.Name != "agent" {
		t.Errorf("author = %#v", reply.Author)
	}
	if reply.Body != "Fixed in 3f1a." {
		t.Errorf("body = %q", reply.Body)
	}

	defaulted, _, err := s.AddReply(c.ID, "second", model.Author{}, "")
	if err != nil {
		t.Fatalf("AddReply: %v", err)
	}
	if defaulted.Author.Name != "Alde Rojas" {
		t.Errorf("author = %#v, want the store author", defaulted.Author)
	}

	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(doc.Comments[0].Replies) != 2 {
		t.Fatalf("replies = %#v", doc.Comments[0].Replies)
	}
	if doc.Comments[0].UpdatedAt == c.UpdatedAt {
		t.Error("a reply should bump the comment updatedAt")
	}
	if _, _, err := s.AddReply(c.ID, "  ", model.Author{}, ""); !errors.Is(err, ErrInvalid) {
		t.Fatal("empty reply body should be rejected")
	}
	if _, _, err := s.AddReply("cmt_nope", "hi", model.Author{}, ""); !errors.Is(err, ErrNotFound) {
		t.Fatal("reply to a missing comment should be ErrNotFound")
	}
}

func TestQuarantineCorruptFile(t *testing.T) {
	corrupt := map[string]string{
		"invalid json":     `{"version": 1, "comments": [`,
		"not an object":    `["nope"]`,
		"duplicate ids":    `{"version":1,"comments":[{"id":"cmt_1","anchor":{"path":"a.go","side":"additions","startLine":1,"endLine":1}},{"id":"cmt_1","anchor":{"path":"a.go","side":"additions","startLine":2,"endLine":2}}]}`,
		"missing id":       `{"version":1,"comments":[{"anchor":{"path":"a.go","side":"additions","startLine":1,"endLine":1}}]}`,
		"missing path":     `{"version":1,"comments":[{"id":"cmt_1","anchor":{"side":"additions","startLine":1,"endLine":1}}]}`,
		"bad side":         `{"version":1,"comments":[{"id":"cmt_1","anchor":{"path":"a.go","side":"sideways","startLine":1,"endLine":1}}]}`,
		"inverted range":   `{"version":1,"comments":[{"id":"cmt_1","anchor":{"path":"a.go","side":"additions","startLine":9,"endLine":2}}]}`,
		"future version":   `{"version":99,"comments":[]}`,
		"negative version": `{"version":-1,"comments":[]}`,
	}

	for name, raw := range corrupt {
		t.Run(name, func(t *testing.T) {
			s := newTestStore(t)
			if err := os.WriteFile(s.Path(), []byte(raw), 0o644); err != nil {
				t.Fatalf("seed: %v", err)
			}

			doc, etag, err := s.Load()
			if err != nil {
				t.Fatalf("Load must not fail on a corrupt file: %v", err)
			}
			if len(doc.Comments) != 0 {
				t.Errorf("comments = %#v, want a fresh doc", doc.Comments)
			}
			if etag == "" {
				t.Error("etag is empty")
			}

			report := s.Report()
			bak := s.Path() + BackupSuffix
			if report.QuarantinePath != bak {
				t.Errorf("QuarantinePath = %q, want %q", report.QuarantinePath, bak)
			}
			if len(report.Issues) == 0 {
				t.Error("quarantine must be reported as an issue")
			}
			saved, err := os.ReadFile(bak)
			if err != nil {
				t.Fatalf("backup: %v", err)
			}
			if string(saved) != raw {
				t.Errorf("backup content = %q, want the original bytes", saved)
			}
			if s.Exists() {
				t.Error("the corrupt file should have been moved aside")
			}

			if _, _, err := s.Add(anchorAt("a.go", 1, 1), "still works"); err != nil {
				t.Fatalf("Add after quarantine: %v", err)
			}
		})
	}
}

func TestLoadToleratesUnknownFieldsAndRepairsGaps(t *testing.T) {
	s := newTestStore(t)
	raw := `{
	  "version": 1,
	  "generator": "agent/1.0",
	  "unknownTopLevel": {"a": 1},
	  "comments": [
	    {
	      "id": "cmt_agent",
	      "status": "definitely-done",
	      "body": "agent wrote this",
	      "severity": "nit",
	      "anchor": {"path": "a.go", "side": "additions", "startLine": 3, "endLine": 4, "extra": true},
	      "replies": [{"body": "no id and no author here"}]
	    }
	  ]
	}`
	if err := os.WriteFile(s.Path(), []byte(raw), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if r := s.Report(); r.Quarantined() {
		t.Fatalf("unknown fields must not quarantine: %#v", r)
	}
	if len(doc.Comments) != 1 {
		t.Fatalf("comments = %#v", doc.Comments)
	}
	c := doc.Comments[0]
	if c.Author.Name != "Alde Rojas" {
		t.Errorf("author = %#v, want the configured fallback", c.Author)
	}
	if c.CreatedAt == "" || c.UpdatedAt == "" {
		t.Errorf("timestamps not filled: %#v", c)
	}
	if len(c.Replies) != 1 || !strings.HasPrefix(c.Replies[0].ID, replyIDPrefix) {
		t.Errorf("replies = %#v", c.Replies)
	}
	if c.Anchor.ContextBefore == nil || c.Anchor.ContextAfter == nil {
		t.Errorf("context slices should be non-nil: %#v", c.Anchor)
	}
	if len(s.Report().Issues) == 0 {
		t.Error("repairs should be reported")
	}
}

func TestSpecAuthoredAgainstSurvivesANewSession(t *testing.T) {
	cfg := testConfig(t)
	first, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	mustAdd(t, first, anchorAt("a.go", 1, 1), "authored against main..feature")

	next := cfg
	next.Spec = model.Spec{Kind: model.SpecWorktree, Left: "HEAD", Right: "worktree"}
	second, err := New(next)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	mustAdd(t, second, anchorAt("b.go", 1, 1), "added in a later session")

	doc, _, err := second.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if doc.Spec.Kind != model.SpecTwoDot {
		t.Errorf("spec kind = %q, want the originally authored two-dot spec", doc.Spec.Kind)
	}
}

func TestWriteIsAtomicRenameNotTruncate(t *testing.T) {
	s := newTestStore(t)
	mustAdd(t, s, anchorAt("a.go", 1, 1), "first")

	if err := os.Chmod(s.Path(), 0o400); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	if _, _, err := s.Add(anchorAt("b.go", 1, 1), "second"); err != nil {
		t.Fatalf("Add over a read-only file must succeed via rename: %v", err)
	}

	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(doc.Comments) != 2 {
		t.Fatalf("comments = %d, want 2", len(doc.Comments))
	}
	fi, err := os.Stat(s.Path())
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if fi.Mode().Perm() != filePerm {
		t.Errorf("mode = %v, want %v", fi.Mode().Perm(), os.FileMode(filePerm))
	}
}

func TestConcurrentReadersNeverSeeAPartialDoc(t *testing.T) {
	s := newTestStore(t)
	c := mustAdd(t, s, anchorAt("a.go", 1, 1), "seed")

	stop := make(chan struct{})
	var wg sync.WaitGroup
	for range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				raw, err := os.ReadFile(s.Path())
				if err != nil {
					continue
				}
				var doc model.CommentsDoc
				if err := json.Unmarshal(raw, &doc); err != nil {
					t.Errorf("read a partial document (%d bytes): %v", len(raw), err)
					return
				}
				if len(doc.Comments) == 0 {
					t.Errorf("read a document with no comments: %q", raw)
					return
				}
			}
		}()
	}

	for i := range 60 {
		body := strings.Repeat("padding for a bigger write ", i+1)
		if _, _, err := s.Update(c.ID, &body, ""); err != nil {
			t.Fatalf("Update: %v", err)
		}
	}
	close(stop)
	wg.Wait()

	leftovers, err := filepath.Glob(filepath.Join(filepath.Dir(s.Path()), "*"+DefaultFileName+".tmp*"))
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(leftovers) != 0 {
		t.Errorf("temp files left behind: %v", leftovers)
	}
}

func TestSaveValidatesAndHonoursIfMatch(t *testing.T) {
	s := newTestStore(t)
	mustAdd(t, s, anchorAt("a.go", 1, 1), "seed")

	doc, etag, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	doc.Comments[0].Anchor.Side = "sideways"
	if _, err := s.Save(doc, etag); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Save err = %v, want ErrInvalid", err)
	}

	doc.Comments[0].Anchor.Side = model.SideDeletions
	if _, err := s.Save(doc, "0123456789abcdef0123456789abcdef"); !errors.Is(err, ErrConflict) {
		t.Fatalf("Save err = %v, want ErrConflict", err)
	}
	if _, err := s.Save(doc, etag); err != nil {
		t.Fatalf("Save: %v", err)
	}
}

func TestSaveFillsDocumentHeaderFromConfig(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Save(&model.CommentsDoc{}, ""); err != nil {
		t.Fatalf("Save: %v", err)
	}

	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if doc.Version != model.SchemaVersion {
		t.Errorf("version = %d", doc.Version)
	}
	if doc.Generator != "dv/0.1.0" {
		t.Errorf("generator = %q", doc.Generator)
	}
	if doc.Repo.Root == "" || doc.Spec.Kind != model.SpecTwoDot {
		t.Errorf("repo/spec not filled: %#v %#v", doc.Repo, doc.Spec)
	}
	if doc.UpdatedAt == "" {
		t.Error("updatedAt not stamped")
	}
	if doc.Comments == nil {
		t.Error("comments must be a non-nil slice")
	}
}

func TestAuthorFallsBackToUnknown(t *testing.T) {
	cfg := testConfig(t)
	cfg.Author = model.Author{}
	cfg.Generator = ""
	s, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	c := mustAdd(t, s, anchorAt("a.go", 1, 1), "body")
	if c.Author.Name != "unknown" {
		t.Errorf("author = %#v, want unknown", c.Author)
	}
	doc, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if doc.Generator != "dv" {
		t.Errorf("generator = %q, want the default dv", doc.Generator)
	}
}

func TestNewRequiresAPathOrRepoRoot(t *testing.T) {
	if _, err := New(Config{}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
	dir := t.TempDir()
	if _, err := New(Config{Path: dir}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("directory path err = %v, want ErrInvalid", err)
	}
	s, err := New(Config{Repo: model.RepoRef{Root: dir}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if s.Path() != filepath.Join(dir, DefaultFileName) {
		t.Errorf("path = %q", s.Path())
	}
}

func TestIDsAreUniqueAndSortable(t *testing.T) {
	const n = 5000
	seen := make(map[string]struct{}, n)
	prev := ""
	for range n {
		id := newID(commentIDPrefix)
		if _, dup := seen[id]; dup {
			t.Fatalf("duplicate id %q", id)
		}
		seen[id] = struct{}{}
		if id <= prev {
			t.Fatalf("id %q does not sort after %q", id, prev)
		}
		prev = id
		if strings.Trim(strings.TrimPrefix(id, commentIDPrefix), crockford) != "" {
			t.Fatalf("id %q is not crockford base32", id)
		}
	}
}
