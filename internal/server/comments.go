package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/alde/dv/internal/comments"
	"github.com/alde/dv/internal/gitx"
	"github.com/alde/dv/internal/model"
)

const contextLines = 3

type contentResolver struct {
	repo *gitx.Repo
	spec *gitx.RevSpec
}

func NewContentResolver(repo *gitx.Repo, spec *gitx.RevSpec) comments.ContentResolver {
	return contentResolver{repo: repo, spec: spec}
}

func (c contentResolver) SideContent(path string, side model.AnnotationSide) ([]string, string, error) {
	return c.repo.SideContent(c.spec, path, side)
}

type commentsResponse struct {
	Doc  *model.CommentsDoc `json:"doc"`
	ETag string             `json:"etag"`
}

type anchorRequest struct {
	Path      string               `json:"path"`
	Side      model.AnnotationSide `json:"side"`
	StartLine int                  `json:"startLine"`
	EndLine   int                  `json:"endLine"`
}

type createRequest struct {
	Anchor anchorRequest `json:"anchor"`
	Body   string        `json:"body"`
}

type updateRequest struct {
	Body *string `json:"body"`
}

type replyRequest struct {
	Body string `json:"body"`
}

type resolution struct {
	doc     *model.CommentsDoc
	etag    string
	dropped []model.Comment
	changed bool
}

// Reanchor re-resolves every anchor against the current diff and drops the
// comments it cannot show — the unanchorable ones, and the ones whose file the
// manifest does not cover. A nil manifest keeps every path. It reports what it
// dropped and whether the file on disk changed.
func Reanchor(store *comments.Store, resolver comments.ContentResolver, manifest *model.Manifest, log *slog.Logger) ([]model.Comment, bool, error) {
	if store == nil || !store.Exists() {
		return nil, false, nil
	}
	var paths comments.PathSet
	if manifest != nil {
		paths = comments.NewPathSet(manifest.Files)
	}
	out, err := resolveAndPersist(store, resolver, log, paths, true)
	return out.dropped, out.changed, err
}

// resolveAndPersist re-resolves the anchors and writes the document back if
// that changed it. Cleaning is for the one-shot startup pass: a comment that
// goes stale while dv is running stays put so the inbox can still surface it.
func resolveAndPersist(store *comments.Store, resolver comments.ContentResolver, log *slog.Logger, paths comments.PathSet, clean bool) (resolution, error) {
	doc, etag, err := store.Load()
	if err != nil {
		return resolution{}, err
	}
	before, err := json.Marshal(doc)
	if err != nil {
		return resolution{}, err
	}
	if err := store.Resolve(doc, resolver); err != nil {
		return resolution{}, err
	}
	var dropped []model.Comment
	if clean {
		dropped = store.PruneStale(doc, paths)
	}
	after, err := json.Marshal(doc)
	if err != nil {
		return resolution{}, err
	}
	if bytes.Equal(before, after) {
		return resolution{doc: doc, etag: etag}, nil
	}
	saved, err := store.Save(doc, etag)
	if err != nil {
		log.Warn("cannot persist the re-anchored comments", "path", store.Path(), "error", err)
		return resolution{doc: doc, etag: etag}, nil
	}
	return resolution{doc: doc, etag: saved, dropped: dropped, changed: true}, nil
}

func (s *Server) snapshot() (*model.CommentsDoc, string, error) {
	out, err := resolveAndPersist(s.opts.Store, s.resolver, s.log, nil, false)
	return out.doc, out.etag, err
}

func (s *Server) commentsEnabled(w http.ResponseWriter) bool {
	if s.opts.Store != nil {
		return true
	}
	writeError(w, http.StatusNotFound, "comments are disabled", "dv was started with --no-comments")
	return false
}

func (s *Server) handleCommentsList(w http.ResponseWriter, r *http.Request) {
	if !s.commentsEnabled(w) {
		return
	}
	doc, etag, err := s.snapshot()
	if err != nil {
		s.fail(w, r, err)
		return
	}
	setETag(w, etag)
	writeJSON(w, http.StatusOK, commentsResponse{Doc: doc, ETag: etag})
}

func (s *Server) handleCommentsCreate(w http.ResponseWriter, r *http.Request) {
	if !s.commentsEnabled(w) {
		return
	}
	var req createRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	anchor, err := s.buildAnchor(req.Anchor)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	comment, etag, err := s.opts.Store.Add(anchor, req.Body, r.Header.Get("If-Match"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	setETag(w, etag)
	writeJSON(w, http.StatusCreated, comment)
}

func (s *Server) handleCommentsUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.commentsEnabled(w) {
		return
	}
	var req updateRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Body == nil {
		writeError(w, http.StatusBadRequest, "nothing to update", "send a body")
		return
	}
	comment, etag, err := s.opts.Store.Update(r.PathValue("id"), req.Body, r.Header.Get("If-Match"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	setETag(w, etag)
	writeJSON(w, http.StatusOK, comment)
}

func (s *Server) handleCommentsDelete(w http.ResponseWriter, r *http.Request) {
	if !s.commentsEnabled(w) {
		return
	}
	etag, err := s.opts.Store.Delete(r.PathValue("id"), r.Header.Get("If-Match"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	setETag(w, etag)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCommentsReply(w http.ResponseWriter, r *http.Request) {
	if !s.commentsEnabled(w) {
		return
	}
	var req replyRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	reply, etag, err := s.opts.Store.AddReply(r.PathValue("id"), req.Body, r.Header.Get("If-Match"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	setETag(w, etag)
	writeJSON(w, http.StatusCreated, reply)
}

func (s *Server) handleCommentsStream(w http.ResponseWriter, r *http.Request) {
	if !s.commentsEnabled(w) {
		return
	}
	release := s.activity.open()
	defer release()

	ctx := r.Context()
	changes, err := s.opts.Store.Watch(ctx)
	if err != nil {
		s.log.Warn("cannot watch the comments file, pushing the current state only", "path", s.opts.Store.Path(), "error", err)
	}

	stream, err := openSSE(w)
	if err != nil {
		s.log.Debug("cannot start the comments stream", "error", err)
		return
	}
	if !s.pushComments(stream) {
		return
	}

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
		case _, ok := <-changes:
			if !ok {
				return
			}
			if !s.pushComments(stream) {
				return
			}
		}
	}
}

func (s *Server) pushComments(stream *sseStream) bool {
	doc, etag, err := s.snapshot()
	if err != nil {
		_, message := classify(err)
		stream.json("fatal", model.Error{Error: message, Detail: err.Error()})
		return false
	}
	return stream.json("comments", commentsResponse{Doc: doc, ETag: etag}) == nil
}

func (s *Server) buildAnchor(req anchorRequest) (model.Anchor, error) {
	path := strings.TrimSpace(req.Path)
	if path == "" {
		return model.Anchor{}, fmt.Errorf("%w: anchor.path is required", comments.ErrInvalid)
	}
	side := req.Side
	if side == "" {
		side = model.SideAdditions
	}
	if side != model.SideAdditions && side != model.SideDeletions {
		return model.Anchor{}, fmt.Errorf("%w: anchor.side %q is neither %q nor %q", comments.ErrInvalid, side, model.SideAdditions, model.SideDeletions)
	}
	start, end := req.StartLine, req.EndLine
	if start < 0 {
		return model.Anchor{}, fmt.Errorf("%w: anchor.startLine %d is negative", comments.ErrInvalid, start)
	}
	if end < start {
		end = start
	}

	lines, blobSha, err := s.opts.Repo.SideContent(s.opts.Spec, path, side)
	if err != nil {
		return model.Anchor{}, err
	}

	anchor := model.Anchor{
		Path:          path,
		Side:          side,
		StartLine:     start,
		EndLine:       end,
		BlobSha:       blobSha,
		Lang:          langFor(path),
		ContextBefore: []string{},
		ContextAfter:  []string{},
	}
	if prev := s.prevPathFor(path); prev != "" {
		anchor.PrevPath = &prev
	}
	if start == 0 {
		anchor.EndLine = 0
		return anchor, nil
	}
	if start > len(lines) {
		return model.Anchor{}, fmt.Errorf("%w: %s has %d lines on the %s side, cannot anchor at line %d",
			comments.ErrInvalid, path, len(lines), side, start)
	}
	if end > len(lines) {
		end = len(lines)
		anchor.EndLine = end
	}
	anchor.Quote = strings.Join(lines[start-1:end], "\n")
	anchor.ContextBefore = slices.Clone(lines[max(0, start-1-contextLines) : start-1])
	anchor.ContextAfter = slices.Clone(lines[end:min(len(lines), end+contextLines)])
	return anchor, nil
}

func (s *Server) prevPathFor(path string) string {
	m, err := s.cachedManifest()
	if err != nil {
		return ""
	}
	for _, e := range m.Files {
		if e.Path == path {
			return e.PrevPath
		}
	}
	return ""
}

func setETag(w http.ResponseWriter, etag string) {
	if etag == "" {
		return
	}
	w.Header().Set("ETag", `"`+etag+`"`)
}
