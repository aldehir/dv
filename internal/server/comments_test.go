package server

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/alde/dv/internal/model"
)

func createComment(t *testing.T, h *harness, body string) model.Comment {
	t.Helper()
	res := h.request(http.MethodPost, "/api/comments", body, nil)
	wantStatus(t, res, http.StatusCreated)
	var comment model.Comment
	h.decode(res, &comment)
	if res.Header.Get("ETag") == "" {
		t.Error("POST /api/comments returned no ETag header")
	}
	return comment
}

func TestCreateCommentFillsAnchorServerSide(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	comment := createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":5,"endLine":6},"body":"wrap this error"}`)

	anchor := comment.Anchor
	if anchor.BlobSha == "" {
		t.Error("anchor.blobSha is empty, the server should resolve it")
	}
	if anchor.Lang != "go" {
		t.Errorf("anchor.lang = %q, want go", anchor.Lang)
	}
	wantQuote := "func Run() error {\n\treturn errors.New(\"boom\")"
	if anchor.Quote != wantQuote {
		t.Errorf("anchor.quote = %q, want %q", anchor.Quote, wantQuote)
	}
	wantBefore := []string{"", "import \"errors\"", ""}
	if strings.Join(anchor.ContextBefore, "|") != strings.Join(wantBefore, "|") {
		t.Errorf("anchor.contextBefore = %q, want %q", anchor.ContextBefore, wantBefore)
	}
	wantAfter := []string{"}"}
	if strings.Join(anchor.ContextAfter, "|") != strings.Join(wantAfter, "|") {
		t.Errorf("anchor.contextAfter = %q, want %q", anchor.ContextAfter, wantAfter)
	}
	if comment.Author.Name != "Fixture User" {
		t.Errorf("author.name = %q, want Fixture User", comment.Author.Name)
	}
	if comment.Status != model.CommentOpen {
		t.Errorf("status = %q, want open", comment.Status)
	}
}

func TestCreateCommentOnDeletionsSide(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	comment := createComment(t, h, `{"anchor":{"path":"src/legacy.go","side":"deletions","startLine":3,"endLine":3},"body":"why drop this?"}`)
	if comment.Anchor.Quote != "const Legacy = 1" {
		t.Errorf("anchor.quote = %q, want the old side's line", comment.Anchor.Quote)
	}
}

func TestCreateCommentFileLevel(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	comment := createComment(t, h, `{"anchor":{"path":"docs/guide.md","side":"additions","startLine":0,"endLine":0},"body":"needs a title"}`)
	if comment.Anchor.Quote != "" {
		t.Errorf("a file-level anchor should have no quote, got %q", comment.Anchor.Quote)
	}
	if comment.Anchor.BlobSha == "" {
		t.Error("a file-level anchor should still carry the side's blob sha")
	}
	if comment.Anchor.Lang != "markdown" {
		t.Errorf("anchor.lang = %q, want markdown", comment.Anchor.Lang)
	}
}

func TestCreateCommentRejectsBadRequests(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	cases := []struct {
		name string
		body string
	}{
		{"no path", `{"anchor":{"side":"additions","startLine":1,"endLine":1},"body":"x"}`},
		{"bad side", `{"anchor":{"path":"src/app.go","side":"middle","startLine":1,"endLine":1},"body":"x"}`},
		{"past the end", `{"anchor":{"path":"src/app.go","side":"additions","startLine":900,"endLine":900},"body":"x"}`},
		{"empty body", `{"anchor":{"path":"src/app.go","side":"additions","startLine":1,"endLine":1},"body":"   "}`},
		{"negative line", `{"anchor":{"path":"src/app.go","side":"additions","startLine":-2,"endLine":-2},"body":"x"}`},
		{"not json", `{`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantStatus(t, h.request(http.MethodPost, "/api/comments", tc.body, nil), http.StatusBadRequest)
		})
	}
}

func TestCreateCommentUnknownPath(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	res := h.request(http.MethodPost, "/api/comments",
		`{"anchor":{"path":"src/nope.go","side":"additions","startLine":1,"endLine":1},"body":"x"}`, nil)
	wantStatus(t, res, http.StatusNotFound)
}

func TestCommentsListReturnsETag(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":1,"endLine":1},"body":"first"}`)

	res := h.get("/api/comments")
	wantStatus(t, res, http.StatusOK)
	if res.Header.Get("ETag") == "" {
		t.Error("GET /api/comments returned no ETag header")
	}

	var payload commentsResponse
	h.decode(res, &payload)
	if payload.ETag == "" {
		t.Error("response body has no etag")
	}
	if len(payload.Doc.Comments) != 1 {
		t.Fatalf("got %d comments, want 1", len(payload.Doc.Comments))
	}
	if payload.Doc.Generator != "dv/test" {
		t.Errorf("generator = %q, want dv/test", payload.Doc.Generator)
	}
}

func TestPatchConflictAndNewETag(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	comment := createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":1,"endLine":1},"body":"first"}`)

	var current commentsResponse
	h.decode(h.get("/api/comments"), &current)

	stale := h.request(http.MethodPatch, "/api/comments/"+comment.ID, `{"status":"resolved"}`,
		map[string]string{"If-Match": "0000000000000000000000000000000f"})
	wantStatus(t, stale, http.StatusConflict)

	fresh := h.request(http.MethodPatch, "/api/comments/"+comment.ID, `{"status":"resolved","body":"first, revised"}`,
		map[string]string{"If-Match": current.ETag})
	wantStatus(t, fresh, http.StatusOK)

	newETag := strings.Trim(fresh.Header.Get("ETag"), `"`)
	if newETag == "" {
		t.Fatal("PATCH returned no ETag header")
	}
	if newETag == current.ETag {
		t.Error("PATCH returned the same ETag as before the mutation")
	}

	var updated model.Comment
	h.decode(fresh, &updated)
	if updated.Status != model.CommentResolved {
		t.Errorf("status = %q, want resolved", updated.Status)
	}
	if updated.Body != "first, revised" {
		t.Errorf("body = %q, want the revised body", updated.Body)
	}
}

func TestPatchUnknownComment(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	wantStatus(t, h.request(http.MethodPatch, "/api/comments/cmt_nope", `{"status":"resolved"}`, nil), http.StatusNotFound)
	wantStatus(t, h.request(http.MethodDelete, "/api/comments/cmt_nope", "", nil), http.StatusNotFound)
	wantStatus(t, h.request(http.MethodPost, "/api/comments/cmt_nope/replies", `{"body":"hi"}`, nil), http.StatusNotFound)
}

func TestPatchWithNothingToChange(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	comment := createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":1,"endLine":1},"body":"first"}`)
	wantStatus(t, h.request(http.MethodPatch, "/api/comments/"+comment.ID, `{}`, nil), http.StatusBadRequest)
}

func TestRepliesAndDelete(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	comment := createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":1,"endLine":1},"body":"first"}`)

	res := h.request(http.MethodPost, "/api/comments/"+comment.ID+"/replies", `{"body":"fixed in 3f1a"}`, nil)
	wantStatus(t, res, http.StatusCreated)
	var reply model.Reply
	h.decode(res, &reply)
	if reply.Body != "fixed in 3f1a" {
		t.Errorf("reply.body = %q", reply.Body)
	}
	if res.Header.Get("ETag") == "" {
		t.Error("POST replies returned no ETag header")
	}

	deleted := h.request(http.MethodDelete, "/api/comments/"+comment.ID, "", nil)
	wantStatus(t, deleted, http.StatusNoContent)
	if deleted.Header.Get("ETag") == "" {
		t.Error("DELETE returned no ETag header")
	}

	var after commentsResponse
	h.decode(h.get("/api/comments"), &after)
	if len(after.Doc.Comments) != 0 {
		t.Errorf("got %d comments after the delete, want 0", len(after.Doc.Comments))
	}
}

func TestReanchorDropsCommentsThatNoLongerAnchor(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	gone := createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":6,"endLine":6},"body":"from an older diff"}`)
	kept := createComment(t, h, `{"anchor":{"path":"docs/guide.md","side":"additions","startLine":3,"endLine":3},"body":"still here"}`)

	doc := h.readDoc(t)
	for i := range doc.Comments {
		if doc.Comments[i].ID != gone.ID {
			continue
		}
		doc.Comments[i].Anchor.BlobSha = "0000000000000000000000000000000000000000"
		doc.Comments[i].Anchor.Quote = "a line this diff never had"
	}
	h.writeDoc(t, doc)

	dropped, changed, err := Reanchor(h.store, NewContentResolver(h.server.opts.Repo, h.server.opts.Spec), h.manifest(t), h.server.log)
	if err != nil {
		t.Fatalf("Reanchor: %v", err)
	}
	if !changed {
		t.Fatal("Reanchor reported no change, want the stale comment removed from disk")
	}
	if len(dropped) != 1 || dropped[0].ID != gone.ID {
		t.Fatalf("dropped = %+v, want just %s", dropped, gone.ID)
	}

	persisted := h.readDoc(t)
	if len(persisted.Comments) != 1 || persisted.Comments[0].ID != kept.ID {
		t.Fatalf("comments on disk = %+v, want just %s", persisted.Comments, kept.ID)
	}
}

// A comment left over from an earlier revspec resolves perfectly well — its
// blob is still in the tree — but this diff has no row to hang it on.
func TestReanchorDropsCommentsOnFilesOutsideTheDiff(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	outside := createComment(t, h, `{"anchor":{"path":"README.md","side":"additions","startLine":1,"endLine":1},"body":"from an older revspec"}`)
	inside := createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":6,"endLine":6},"body":"about this diff"}`)

	before := h.readDoc(t)
	if len(before.Comments) != 2 {
		t.Fatalf("setup wrote %d comments, want 2", len(before.Comments))
	}

	dropped, changed, err := Reanchor(h.store, NewContentResolver(h.server.opts.Repo, h.server.opts.Spec), h.manifest(t), h.server.log)
	if err != nil {
		t.Fatalf("Reanchor: %v", err)
	}
	if !changed {
		t.Fatal("Reanchor reported no change, want the out-of-diff comment removed")
	}
	if len(dropped) != 1 || dropped[0].ID != outside.ID {
		t.Fatalf("dropped = %+v, want just %s", dropped, outside.ID)
	}

	persisted := h.readDoc(t)
	if len(persisted.Comments) != 1 || persisted.Comments[0].ID != inside.ID {
		t.Fatalf("comments on disk = %+v, want just %s", persisted.Comments, inside.ID)
	}
}

func TestReanchorWithoutAManifestKeepsEveryPath(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	createComment(t, h, `{"anchor":{"path":"README.md","side":"additions","startLine":1,"endLine":1},"body":"outside the diff"}`)

	dropped, _, err := Reanchor(h.store, NewContentResolver(h.server.opts.Repo, h.server.opts.Spec), nil, h.server.log)
	if err != nil {
		t.Fatalf("Reanchor: %v", err)
	}
	if len(dropped) != 0 {
		t.Fatalf("dropped %+v, want nothing dropped when there is no manifest to judge by", dropped)
	}
}

func TestSnapshotKeepsCommentsThatGoStaleWhileRunning(t *testing.T) {
	h := newHarness(t, seedRepo(t), nil)
	comment := createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":6,"endLine":6},"body":"watch this"}`)

	doc := h.readDoc(t)
	doc.Comments[0].Anchor.BlobSha = "0000000000000000000000000000000000000000"
	doc.Comments[0].Anchor.Quote = "a line this diff never had"
	h.writeDoc(t, doc)

	var res commentsResponse
	h.decode(h.get("/api/comments"), &res)
	if len(res.Doc.Comments) != 1 || res.Doc.Comments[0].ID != comment.ID {
		t.Fatalf("comments = %+v, want %s kept and flagged", res.Doc.Comments, comment.ID)
	}
	if resolved := res.Doc.Comments[0].ResolvedAnchor; resolved == nil || !resolved.Stale {
		t.Errorf("resolvedAnchor = %+v, want stale", resolved)
	}
}

func TestReanchorPersistsToDisk(t *testing.T) {
	f := seedRepo(t)
	h := newHarness(t, f, nil)
	createComment(t, h, `{"anchor":{"path":"src/app.go","side":"additions","startLine":6,"endLine":6},"body":"wrap it"}`)

	raw, err := os.ReadFile(h.commentsPath())
	if err != nil {
		t.Fatalf("read comments file: %v", err)
	}
	var doc model.CommentsDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	doc.Comments[0].Anchor.StartLine = 2
	doc.Comments[0].Anchor.EndLine = 2
	doc.Comments[0].Anchor.BlobSha = "0000000000000000000000000000000000000000"
	rewritten, err := json.MarshalIndent(&doc, "", "  ")
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(h.commentsPath(), rewritten, 0o644); err != nil {
		t.Fatalf("write comments file: %v", err)
	}

	dropped, changed, err := Reanchor(h.store, NewContentResolver(h.server.opts.Repo, h.server.opts.Spec), h.manifest(t), h.server.log)
	if err != nil {
		t.Fatalf("Reanchor: %v", err)
	}
	if !changed {
		t.Fatal("Reanchor reported no change, want the moved anchor written back")
	}
	if len(dropped) != 0 {
		t.Fatalf("dropped %d comments, want the re-anchorable one kept", len(dropped))
	}

	saved, err := os.ReadFile(h.commentsPath())
	if err != nil {
		t.Fatalf("re-read comments file: %v", err)
	}
	var persisted model.CommentsDoc
	if err := json.Unmarshal(saved, &persisted); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	anchor := persisted.Comments[0].Anchor
	if anchor.StartLine != 6 || anchor.EndLine != 6 {
		t.Errorf("anchor is at %d-%d after re-anchoring, want 6-6", anchor.StartLine, anchor.EndLine)
	}
	resolved := persisted.Comments[0].ResolvedAnchor
	if resolved == nil || resolved.MovedFrom == nil || resolved.MovedFrom.StartLine != 2 {
		t.Errorf("resolvedAnchor.movedFrom was not recorded on disk: %+v", resolved)
	}

	if _, _, err := Reanchor(h.store, NewContentResolver(h.server.opts.Repo, h.server.opts.Spec), h.manifest(t), h.server.log); err != nil {
		t.Fatalf("second Reanchor: %v", err)
	}
	_, again, err := Reanchor(h.store, NewContentResolver(h.server.opts.Repo, h.server.opts.Spec), h.manifest(t), h.server.log)
	if err != nil {
		t.Fatalf("third Reanchor: %v", err)
	}
	if again {
		t.Error("Reanchor kept rewriting the file, it must settle into a no-op")
	}

	var settled commentsResponse
	h.decode(h.get("/api/comments"), &settled)
	final := settled.Doc.Comments[0].ResolvedAnchor
	if final == nil || final.Stale || final.Rule != "exact" {
		t.Errorf("once the blob sha is written back the anchor should resolve exactly, got %+v", final)
	}
}
