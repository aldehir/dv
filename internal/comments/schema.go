package comments

import (
	"cmp"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/alde/dv/internal/model"
)

var ErrSchema = errors.New("comments: unreadable document")

func validSide(s model.AnnotationSide) bool {
	return s == model.SideAdditions || s == model.SideDeletions
}

func validateAnchor(a model.Anchor) error {
	if strings.TrimSpace(a.Path) == "" {
		return errors.New("anchor has no path")
	}
	if !validSide(a.Side) {
		return fmt.Errorf("anchor side %q is neither %q nor %q", a.Side, model.SideAdditions, model.SideDeletions)
	}
	if a.StartLine < 0 || a.EndLine < 0 {
		return fmt.Errorf("anchor line range %d-%d is negative", a.StartLine, a.EndLine)
	}
	if a.EndLine < a.StartLine {
		return fmt.Errorf("anchor line range %d-%d ends before it starts", a.StartLine, a.EndLine)
	}
	return nil
}

func validate(doc *model.CommentsDoc) error {
	if doc == nil {
		return fmt.Errorf("%w: document is empty", ErrSchema)
	}
	if doc.Version < 0 {
		return fmt.Errorf("%w: version %d is negative", ErrSchema, doc.Version)
	}
	if doc.Version > model.SchemaVersion {
		return fmt.Errorf("%w: version %d is newer than the supported version %d", ErrSchema, doc.Version, model.SchemaVersion)
	}
	seen := make(map[string]struct{}, len(doc.Comments))
	for i := range doc.Comments {
		c := &doc.Comments[i]
		if strings.TrimSpace(c.ID) == "" {
			return fmt.Errorf("%w: comments[%d] has no id", ErrSchema, i)
		}
		if _, dup := seen[c.ID]; dup {
			return fmt.Errorf("%w: comments[%d] repeats id %q", ErrSchema, i, c.ID)
		}
		seen[c.ID] = struct{}{}
		if err := validateAnchor(c.Anchor); err != nil {
			return fmt.Errorf("%w: comments[%d] (%s): %s", ErrSchema, i, c.ID, err)
		}
	}
	return nil
}

func repair(doc *model.CommentsDoc, now string) []string {
	var issues []string
	note := func(format string, args ...any) {
		issues = append(issues, fmt.Sprintf(format, args...))
	}
	if doc.Version == 0 {
		doc.Version = model.SchemaVersion
		note("document had no version, assuming %d", model.SchemaVersion)
	}
	if doc.Comments == nil {
		doc.Comments = []model.Comment{}
	}
	for i := range doc.Comments {
		c := &doc.Comments[i]
		if c.CreatedAt == "" {
			c.CreatedAt = now
			note("comment %s had no createdAt", c.ID)
		}
		if c.UpdatedAt == "" {
			c.UpdatedAt = c.CreatedAt
		}
		if c.Anchor.ContextBefore == nil {
			c.Anchor.ContextBefore = []string{}
		}
		if c.Anchor.ContextAfter == nil {
			c.Anchor.ContextAfter = []string{}
		}
		if c.Replies == nil {
			c.Replies = []model.Reply{}
		}
		for j := range c.Replies {
			r := &c.Replies[j]
			if strings.TrimSpace(r.ID) == "" {
				r.ID = newID(replyIDPrefix)
				note("comment %s reply %d had no id, assigned %s", c.ID, j, r.ID)
			}
			if r.CreatedAt == "" {
				r.CreatedAt = c.UpdatedAt
			}
		}
	}
	return issues
}

func sortComments(doc *model.CommentsDoc) {
	slices.SortStableFunc(doc.Comments, func(x, y model.Comment) int {
		return cmp.Or(
			strings.Compare(x.Anchor.Path, y.Anchor.Path),
			cmp.Compare(x.Anchor.StartLine, y.Anchor.StartLine),
			cmp.Compare(x.Anchor.EndLine, y.Anchor.EndLine),
			strings.Compare(x.ID, y.ID),
		)
	})
}
