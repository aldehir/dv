package comments

import (
	"errors"
	"strings"
	"testing"

	"github.com/alde/dv/internal/model"
)

type fakeSide struct {
	lines []string
	sha   string
	err   error
}

type fakeResolver struct {
	sides map[string]fakeSide
	calls map[string]int
}

func newFakeResolver() *fakeResolver {
	return &fakeResolver{sides: map[string]fakeSide{}, calls: map[string]int{}}
}

func (f *fakeResolver) set(path string, side model.AnnotationSide, sha, content string) {
	f.sides[string(side)+"|"+path] = fakeSide{lines: strings.Split(content, "\n"), sha: sha}
}

func (f *fakeResolver) fail(path string, side model.AnnotationSide, err error) {
	f.sides[string(side)+"|"+path] = fakeSide{err: err}
}

func (f *fakeResolver) SideContent(path string, side model.AnnotationSide) ([]string, string, error) {
	key := string(side) + "|" + path
	f.calls[key]++
	e, ok := f.sides[key]
	if !ok {
		return nil, "", errors.New("no such path: " + path)
	}
	return e.lines, e.sha, e.err
}

const drainBefore = `package gitx

func (r *Reader) drain() error {
	for {
		if err := r.next(); err != nil {
			return err
		}
	}
}`

const drainAfter = `package gitx

import "io"

func (r *Reader) close() error { return nil }

func (r *Reader) drain() error {
	for {
		if err := r.next(); err != nil {
			return err
		}
	}
}`

const quote = "\tfor {\n\t\tif err := r.next(); err != nil {\n"

func drainComment() model.Comment {
	return model.Comment{
		ID:     "cmt_drain",
		Status: model.CommentOpen,
		Body:   "This retries forever if the context is already cancelled.",
		Anchor: model.Anchor{
			Path:      "internal/gitx/blob.go",
			Side:      model.SideAdditions,
			StartLine: 4,
			EndLine:   5,
			BlobSha:   "oldsha",
			Lang:      "go",
			Quote:     quote,
		},
	}
}

func docWith(comments ...model.Comment) *model.CommentsDoc {
	return &model.CommentsDoc{Version: model.SchemaVersion, Comments: comments}
}

func resolve(t *testing.T, doc *model.CommentsDoc, r ContentResolver) {
	t.Helper()
	s := newTestStore(t)
	if err := s.Resolve(doc, r); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
}

func TestResolveExactWhenBlobShaMatches(t *testing.T) {
	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "oldsha", drainAfter)

	doc := docWith(drainComment())
	resolve(t, doc, r)

	c := doc.Comments[0]
	if c.ResolvedAnchor.Rule != RuleExact {
		t.Errorf("rule = %q, want %q", c.ResolvedAnchor.Rule, RuleExact)
	}
	if c.ResolvedAnchor.Stale {
		t.Error("an exact match must not be stale")
	}
	if c.ResolvedAnchor.MovedFrom != nil {
		t.Errorf("movedFrom = %#v, want nil", c.ResolvedAnchor.MovedFrom)
	}
	if c.Anchor.StartLine != 4 || c.Anchor.EndLine != 5 {
		t.Errorf("lines = %d-%d, want the stored 4-5 verbatim", c.Anchor.StartLine, c.Anchor.EndLine)
	}
}

func TestResolveReanchorsOnUniqueQuoteMatch(t *testing.T) {
	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "newsha", drainAfter)

	doc := docWith(drainComment())
	resolve(t, doc, r)

	c := doc.Comments[0]
	if c.ResolvedAnchor.Rule != RuleQuote {
		t.Errorf("rule = %q, want %q", c.ResolvedAnchor.Rule, RuleQuote)
	}
	if c.ResolvedAnchor.Stale {
		t.Error("a unique quote match must not be stale")
	}
	if c.Anchor.StartLine != 8 || c.Anchor.EndLine != 9 {
		t.Errorf("lines = %d-%d, want 8-9", c.Anchor.StartLine, c.Anchor.EndLine)
	}
	mf := c.ResolvedAnchor.MovedFrom
	if mf == nil || mf.StartLine != 4 || mf.EndLine != 5 {
		t.Errorf("movedFrom = %#v, want 4-5", mf)
	}
	if c.Anchor.BlobSha != "newsha" {
		t.Errorf("blobSha = %q, want it refreshed to newsha", c.Anchor.BlobSha)
	}
}

func TestResolveQuoteMatchInPlaceRecordsNoMove(t *testing.T) {
	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "newsha", drainBefore)

	doc := docWith(drainComment())
	resolve(t, doc, r)

	c := doc.Comments[0]
	if c.ResolvedAnchor.Rule != RuleQuote || c.ResolvedAnchor.Stale {
		t.Errorf("resolvedAnchor = %#v", c.ResolvedAnchor)
	}
	if c.ResolvedAnchor.MovedFrom != nil {
		t.Errorf("movedFrom = %#v, want nil when the lines did not move", c.ResolvedAnchor.MovedFrom)
	}
}

func TestResolveWhitespaceFallback(t *testing.T) {
	reindented := strings.ReplaceAll(drainAfter, "\t", "    ")
	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "newsha", reindented)

	doc := docWith(drainComment())
	resolve(t, doc, r)

	c := doc.Comments[0]
	if c.ResolvedAnchor.Rule != RuleWhitespace {
		t.Errorf("rule = %q, want %q", c.ResolvedAnchor.Rule, RuleWhitespace)
	}
	if c.ResolvedAnchor.Stale {
		t.Error("a whitespace-only difference must not be stale")
	}
	if c.Anchor.StartLine != 8 || c.Anchor.EndLine != 9 {
		t.Errorf("lines = %d-%d, want 8-9", c.Anchor.StartLine, c.Anchor.EndLine)
	}
}

func TestResolveAmbiguousKeepsTheCommentAndMarksStale(t *testing.T) {
	doubled := drainAfter + "\n\nfunc (r *Reader) drainAgain() error {\n" + strings.TrimSuffix(quote, "\n") + "\n\t\t\treturn err\n\t\t}\n\t}\n}"
	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "newsha", doubled)

	doc := docWith(drainComment())
	resolve(t, doc, r)

	c := doc.Comments[0]
	if c.ResolvedAnchor.Rule != RuleAmbiguous {
		t.Errorf("rule = %q, want %q", c.ResolvedAnchor.Rule, RuleAmbiguous)
	}
	if !c.ResolvedAnchor.Stale {
		t.Error("an ambiguous match must be stale")
	}
	if len(doc.Comments) != 1 {
		t.Fatal("the comment must never be dropped")
	}
	if c.Anchor.StartLine != 4 || c.Anchor.EndLine != 5 {
		t.Errorf("lines = %d-%d, want the original 4-5 left alone", c.Anchor.StartLine, c.Anchor.EndLine)
	}
	if c.Body == "" {
		t.Error("the body must survive")
	}
}

func TestResolveGoneKeepsTheComment(t *testing.T) {
	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "newsha", "package gitx\n\nfunc nothing() {}\n")

	doc := docWith(drainComment())
	resolve(t, doc, r)

	c := doc.Comments[0]
	if c.ResolvedAnchor.Rule != RuleGone {
		t.Errorf("rule = %q, want %q", c.ResolvedAnchor.Rule, RuleGone)
	}
	if !c.ResolvedAnchor.Stale {
		t.Error("a vanished quote must be stale")
	}
	if len(doc.Comments) != 1 || doc.Comments[0].Body == "" {
		t.Fatal("the comment must never be dropped")
	}
}

func TestResolveUnresolvableSideIsStaleNotFatal(t *testing.T) {
	r := newFakeResolver()
	r.fail("internal/gitx/blob.go", model.SideAdditions, errors.New("blob is too large"))

	doc := docWith(drainComment())
	resolve(t, doc, r)

	c := doc.Comments[0]
	if c.ResolvedAnchor.Rule != RuleUnresolved || !c.ResolvedAnchor.Stale {
		t.Errorf("resolvedAnchor = %#v, want stale/%s", c.ResolvedAnchor, RuleUnresolved)
	}
	if len(doc.Comments) != 1 {
		t.Fatal("the comment must never be dropped")
	}
}

func TestResolveFallsBackToPrevPath(t *testing.T) {
	prev := "internal/gitx/old_blob.go"
	c := drainComment()
	c.Anchor.PrevPath = &prev

	r := newFakeResolver()
	r.set(prev, model.SideAdditions, "newsha", drainAfter)

	doc := docWith(c)
	resolve(t, doc, r)

	got := doc.Comments[0]
	if got.ResolvedAnchor.Rule != RuleQuote || got.ResolvedAnchor.Stale {
		t.Errorf("resolvedAnchor = %#v", got.ResolvedAnchor)
	}
	if got.Anchor.StartLine != 8 {
		t.Errorf("startLine = %d, want 8", got.Anchor.StartLine)
	}
}

func TestResolveFileLevelAnchor(t *testing.T) {
	c := drainComment()
	c.Anchor.StartLine = 0
	c.Anchor.EndLine = 0
	c.Anchor.Quote = ""

	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "newsha", drainAfter)

	doc := docWith(c)
	resolve(t, doc, r)

	got := doc.Comments[0]
	if got.ResolvedAnchor.Rule != RuleFileLevel || got.ResolvedAnchor.Stale {
		t.Errorf("resolvedAnchor = %#v, want a non-stale %s", got.ResolvedAnchor, RuleFileLevel)
	}
	if got.Anchor.BlobSha != "newsha" {
		t.Errorf("blobSha = %q, want it refreshed", got.Anchor.BlobSha)
	}
}

func TestResolveQuotelessAnchorIsStale(t *testing.T) {
	c := drainComment()
	c.Anchor.Quote = "\n"

	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "newsha", drainAfter)

	doc := docWith(c)
	resolve(t, doc, r)

	got := doc.Comments[0]
	if got.ResolvedAnchor.Rule != RuleNoQuote || !got.ResolvedAnchor.Stale {
		t.Errorf("resolvedAnchor = %#v, want stale/%s", got.ResolvedAnchor, RuleNoQuote)
	}
}

func TestResolveKeepsEveryCommentAndCachesSideContent(t *testing.T) {
	exact := drainComment()
	exact.ID = "cmt_exact"

	moved := drainComment()
	moved.ID = "cmt_moved"
	moved.Anchor.BlobSha = "newsha"
	moved.Anchor.StartLine = 40
	moved.Anchor.EndLine = 41

	gone := drainComment()
	gone.ID = "cmt_gone"
	gone.Anchor.BlobSha = "newsha"
	gone.Anchor.Quote = "\tthis line never existed\n"

	missing := drainComment()
	missing.ID = "cmt_missing"
	missing.Anchor.Path = "deleted/file.go"

	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "oldsha", drainAfter)

	doc := docWith(exact, moved, gone, missing)
	resolve(t, doc, r)

	if len(doc.Comments) != 4 {
		t.Fatalf("comments = %d, want all 4 kept", len(doc.Comments))
	}
	rules := map[string]string{}
	for _, c := range doc.Comments {
		rules[c.ID] = c.ResolvedAnchor.Rule
	}
	want := map[string]string{
		"cmt_exact":   RuleExact,
		"cmt_moved":   RuleQuote,
		"cmt_gone":    RuleGone,
		"cmt_missing": RuleUnresolved,
	}
	for id, rule := range want {
		if rules[id] != rule {
			t.Errorf("%s rule = %q, want %q", id, rules[id], rule)
		}
	}
	if n := r.calls["additions|internal/gitx/blob.go"]; n != 1 {
		t.Errorf("side content fetched %d times, want 1 (cached)", n)
	}
}

func TestResolveRejectsANilResolver(t *testing.T) {
	s := newTestStore(t)
	if err := s.Resolve(docWith(drainComment()), nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
	if err := s.Resolve(nil, newFakeResolver()); err != nil {
		t.Fatalf("a nil doc should be a no-op, got %v", err)
	}
}

func TestResolvedAnchorSurvivesASaveRoundTrip(t *testing.T) {
	s := newTestStore(t)
	created := mustAdd(t, s, anchorAt("internal/gitx/blob.go", 4, 5), "keep me")

	doc, etag, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	doc.Comments[0].Anchor.Quote = quote
	doc.Comments[0].Anchor.BlobSha = "oldsha"

	r := newFakeResolver()
	r.set("internal/gitx/blob.go", model.SideAdditions, "newsha", drainAfter)
	if err := s.Resolve(doc, r); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if _, err := s.Save(doc, etag); err != nil {
		t.Fatalf("Save: %v", err)
	}

	reloaded, _, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	got := reloaded.Comments[0]
	if got.ID != created.ID {
		t.Fatalf("id = %q, want %q", got.ID, created.ID)
	}
	if got.Anchor.StartLine != 8 || got.Anchor.EndLine != 9 {
		t.Errorf("lines = %d-%d, want the re-anchored 8-9", got.Anchor.StartLine, got.Anchor.EndLine)
	}
	if got.ResolvedAnchor == nil || got.ResolvedAnchor.Rule != RuleQuote {
		t.Errorf("resolvedAnchor = %#v", got.ResolvedAnchor)
	}
	if got.ResolvedAnchor.MovedFrom == nil || got.ResolvedAnchor.MovedFrom.StartLine != 4 {
		t.Errorf("movedFrom = %#v, want 4-5", got.ResolvedAnchor.MovedFrom)
	}
}
