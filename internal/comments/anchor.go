package comments

import (
	"fmt"
	"strings"

	"github.com/alde/dv/internal/model"
)

const (
	RuleExact      = "exact"
	RuleFileLevel  = "file-level"
	RuleQuote      = "quote"
	RuleWhitespace = "quote-whitespace"
	RuleAmbiguous  = "ambiguous"
	RuleGone       = "gone"
	RuleNoQuote    = "no-quote"
	RuleUnresolved = "unresolved"
)

type ContentResolver interface {
	SideContent(path string, side model.AnnotationSide) (lines []string, blobSha string, err error)
}

func (s *Store) Resolve(doc *model.CommentsDoc, r ContentResolver) error {
	if doc == nil {
		return nil
	}
	if r == nil {
		return fmt.Errorf("%w: nil content resolver", ErrInvalid)
	}
	cache := &contentCache{resolver: r, entries: map[string]contentEntry{}}
	for i := range doc.Comments {
		c := &doc.Comments[i]
		resolveComment(c, cache)
		s.log.Debug("resolved comment anchor",
			"id", c.ID,
			"path", c.Anchor.Path,
			"side", c.Anchor.Side,
			"rule", c.ResolvedAnchor.Rule,
			"stale", c.ResolvedAnchor.Stale,
			"lines", fmt.Sprintf("%d-%d", c.Anchor.StartLine, c.Anchor.EndLine),
		)
	}
	sortComments(doc)
	return nil
}

func resolveComment(c *model.Comment, cache *contentCache) {
	a := &c.Anchor

	lines, blobSha, err := cache.get(a.Path, a.Side)
	if err != nil && a.PrevPath != nil && *a.PrevPath != "" && *a.PrevPath != a.Path {
		lines, blobSha, err = cache.get(*a.PrevPath, a.Side)
	}
	if err != nil {
		setResolved(c, true, nil, RuleUnresolved)
		return
	}
	if a.BlobSha != "" && blobSha != "" && a.BlobSha == blobSha {
		setResolved(c, false, nil, RuleExact)
		return
	}
	if a.StartLine == 0 {
		a.BlobSha = blobSha
		setResolved(c, false, nil, RuleFileLevel)
		return
	}

	want := quoteLines(a.Quote)
	if len(want) == 0 {
		setResolved(c, true, nil, RuleNoQuote)
		return
	}

	rule := RuleQuote
	matches := findMatches(lines, want, identity)
	if len(matches) == 0 {
		rule = RuleWhitespace
		matches = findMatches(lines, want, squeezeSpace)
	}

	switch len(matches) {
	case 1:
		reanchor(c, matches[0]+1, matches[0]+len(want), blobSha, rule)
	case 0:
		setResolved(c, true, nil, RuleGone)
	default:
		setResolved(c, true, nil, RuleAmbiguous)
	}
}

func reanchor(c *model.Comment, startLine, endLine int, blobSha, rule string) {
	a := &c.Anchor
	var moved *model.MovedFrom
	if a.StartLine != startLine || a.EndLine != endLine {
		moved = &model.MovedFrom{StartLine: a.StartLine, EndLine: a.EndLine}
		a.StartLine = startLine
		a.EndLine = endLine
	}
	a.BlobSha = blobSha
	setResolved(c, false, moved, rule)
}

func setResolved(c *model.Comment, stale bool, moved *model.MovedFrom, rule string) {
	c.ResolvedAnchor = &model.ResolvedAnchor{Stale: stale, MovedFrom: moved, Rule: rule}
}

func quoteLines(quote string) []string {
	if quote == "" {
		return nil
	}
	quote = strings.ReplaceAll(quote, "\r\n", "\n")
	quote = strings.TrimSuffix(quote, "\n")
	if quote == "" {
		return nil
	}
	return strings.Split(quote, "\n")
}

func identity(s string) string { return s }

func squeezeSpace(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch r {
		case ' ', '\t', '\v', '\f', '\r', 0x85, 0xA0:
			continue
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func findMatches(lines, want []string, norm func(string) string) []int {
	if len(want) == 0 || len(want) > len(lines) {
		return nil
	}
	normalized := make([]string, len(want))
	for i, l := range want {
		normalized[i] = norm(l)
	}
	haystack := make([]string, len(lines))
	for i, l := range lines {
		haystack[i] = norm(l)
	}
	var out []int
	for i := 0; i+len(want) <= len(haystack); i++ {
		ok := true
		for j := range normalized {
			if haystack[i+j] != normalized[j] {
				ok = false
				break
			}
		}
		if ok {
			out = append(out, i)
			if len(out) > 1 {
				return out
			}
		}
	}
	return out
}

type contentEntry struct {
	lines   []string
	blobSha string
	err     error
}

type contentCache struct {
	resolver ContentResolver
	entries  map[string]contentEntry
}

func (c *contentCache) get(path string, side model.AnnotationSide) ([]string, string, error) {
	key := string(side) + "\x00" + path
	if e, ok := c.entries[key]; ok {
		return e.lines, e.blobSha, e.err
	}
	lines, blobSha, err := c.resolver.SideContent(path, side)
	c.entries[key] = contentEntry{lines: lines, blobSha: blobSha, err: err}
	return lines, blobSha, err
}
