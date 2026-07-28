package comments

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/alde/dv/internal/model"
)

func ExportJSON(doc *model.CommentsDoc, w io.Writer) error {
	if doc == nil {
		return fmt.Errorf("%w: nil document", ErrInvalid)
	}
	raw, err := serialize(doc)
	if err != nil {
		return err
	}
	_, err = w.Write(raw)
	return err
}

func ExportMarkdown(doc *model.CommentsDoc, w io.Writer) error {
	if doc == nil {
		return fmt.Errorf("%w: nil document", ErrInvalid)
	}
	b := bufio.NewWriter(w)

	fmt.Fprint(b, "# Review comments\n\n")
	writeField(b, "- Repo: %s\n", doc.Repo.Root)
	writeField(b, "- Head: %s\n", shortRev(doc.Repo.Head))
	writeField(b, "- Diff: %s\n", describeSpec(doc.Spec))
	writeField(b, "- Generator: %s\n", doc.Generator)
	writeField(b, "- Updated: %s\n", doc.UpdatedAt)
	fmt.Fprintf(b, "- Comments: %s\n", describeCounts(doc.Comments))

	for _, c := range doc.Comments {
		fmt.Fprintf(b, "\n## %s\n\n", anchorLabel(c.Anchor))
		fmt.Fprintf(b, "- Side: %s\n", sideDetail(c.Anchor.Side))
		writeField(b, "- Language: %s\n", c.Anchor.Lang)
		writeField(b, "- Created: %s\n", c.CreatedAt)
		if note := anchorNote(c.ResolvedAnchor); note != "" {
			fmt.Fprintf(b, "- %s\n", note)
		}
		writeQuote(b, c.Anchor)
		fmt.Fprintf(b, "\n%s\n", strings.TrimRight(c.Body, "\n"))
		if len(c.Replies) > 0 {
			fmt.Fprint(b, "\n### Replies\n\n")
			for _, r := range c.Replies {
				fmt.Fprintf(b, "- %s: %s\n", r.CreatedAt, oneLine(r.Body))
			}
		}
	}
	if len(doc.Comments) == 0 {
		fmt.Fprint(b, "\nNo comments.\n")
	}
	return b.Flush()
}

func ExportPrompt(doc *model.CommentsDoc, w io.Writer) error {
	if doc == nil {
		return fmt.Errorf("%w: nil document", ErrInvalid)
	}
	b := bufio.NewWriter(w)

	fmt.Fprint(b, "# Code review comments\n\n")
	writeField(b, "Repo: %s\n", doc.Repo.Root)
	writeField(b, "Diff: %s\n", describeSpec(doc.Spec))
	writeField(b, "Head: %s\n", shortRev(doc.Repo.Head))

	if len(doc.Comments) == 0 {
		fmt.Fprint(b, "\nThere are no review comments.\n")
		return b.Flush()
	}

	fmt.Fprintf(b, "\n%s follow.\n\n", describeCounts(doc.Comments))
	fmt.Fprint(b, "Each comment gives a file, a line range on one side of the diff, the exact\n")
	fmt.Fprint(b, "lines it refers to prefixed with their real line numbers, and the reviewer's\n")
	fmt.Fprint(b, "note. Address each note, then append a reply in comments.json saying what\n")
	fmt.Fprint(b, "you changed.\n")

	for i, c := range doc.Comments {
		fmt.Fprintf(b, "\n## %d. %s (%s)\n", i+1, promptAnchorLabel(c.Anchor), promptSide(c.Anchor))
		if note := anchorNote(c.ResolvedAnchor); note != "" {
			fmt.Fprintf(b, "\n%s.\n", note)
		}
		writeQuote(b, c.Anchor)
		fmt.Fprintf(b, "\n%s\n", strings.TrimRight(c.Body, "\n"))
		if len(c.Replies) > 0 {
			fmt.Fprint(b, "\nReplies:\n")
			for _, r := range c.Replies {
				fmt.Fprintf(b, "- %s\n", oneLine(r.Body))
			}
		}
	}
	return b.Flush()
}

func writeField(b *bufio.Writer, format, value string) {
	if value == "" {
		return
	}
	fmt.Fprintf(b, format, value)
}

func writeQuote(b *bufio.Writer, a model.Anchor) {
	lines := quoteLines(a.Quote)
	if len(lines) == 0 {
		return
	}
	fence := fenceFor(a.Quote)
	fmt.Fprintf(b, "\n%s\n", fence)
	if a.StartLine == 0 {
		for _, l := range lines {
			fmt.Fprintf(b, "%s\n", l)
		}
	} else {
		width := len(strconv.Itoa(a.StartLine + len(lines) - 1))
		for i, l := range lines {
			fmt.Fprintf(b, "%*d | %s\n", width, a.StartLine+i, l)
		}
	}
	fmt.Fprintf(b, "%s\n", fence)
}

func fenceFor(content string) string {
	longest, run := 0, 0
	for _, r := range content {
		if r == '`' {
			run++
			if run > longest {
				longest = run
			}
			continue
		}
		run = 0
	}
	if longest < 3 {
		return "```"
	}
	return strings.Repeat("`", longest+1)
}

func anchorLabel(a model.Anchor) string {
	switch {
	case a.StartLine == 0:
		return a.Path + " (whole file)"
	case a.EndLine > a.StartLine:
		return fmt.Sprintf("%s:%d-%d", a.Path, a.StartLine, a.EndLine)
	default:
		return fmt.Sprintf("%s:%d", a.Path, a.StartLine)
	}
}

func promptAnchorLabel(a model.Anchor) string {
	switch {
	case a.StartLine == 0:
		return a.Path + ", whole file"
	case a.EndLine > a.StartLine:
		return fmt.Sprintf("%s lines %d-%d", a.Path, a.StartLine, a.EndLine)
	default:
		return fmt.Sprintf("%s line %d", a.Path, a.StartLine)
	}
}

func sideLabel(side model.AnnotationSide) string {
	switch side {
	case model.SideDeletions:
		return "old side"
	case model.SideAdditions:
		return "new side"
	default:
		return string(side)
	}
}

func sideDetail(side model.AnnotationSide) string {
	switch side {
	case model.SideDeletions:
		return "deletions (old)"
	case model.SideAdditions:
		return "additions (new)"
	default:
		return string(side)
	}
}

func promptSide(a model.Anchor) string {
	if a.Lang == "" {
		return sideLabel(a.Side)
	}
	return sideLabel(a.Side) + ", " + a.Lang
}

func anchorNote(ra *model.ResolvedAnchor) string {
	if ra == nil {
		return ""
	}
	if ra.Stale {
		return fmt.Sprintf("Anchor is stale (rule: %s) — the line numbers may be wrong, find the code by the quoted lines", ruleOrUnknown(ra.Rule))
	}
	if ra.MovedFrom != nil {
		return fmt.Sprintf("Anchor moved from lines %d-%d (rule: %s)", ra.MovedFrom.StartLine, ra.MovedFrom.EndLine, ruleOrUnknown(ra.Rule))
	}
	return ""
}

func ruleOrUnknown(rule string) string {
	if rule == "" {
		return "unknown"
	}
	return rule
}

func describeSpec(s model.Spec) string {
	var parts []string
	if s.Kind != "" {
		parts = append(parts, string(s.Kind))
	}
	if len(s.Argv) > 0 {
		parts = append(parts, "`"+strings.Join(s.Argv, " ")+"`")
	}
	if s.Left != "" || s.Right != "" {
		parts = append(parts, fmt.Sprintf("(%s..%s)", shortRev(s.Left), shortRev(s.Right)))
	}
	if s.MergeBase != "" {
		parts = append(parts, "merge-base "+shortRev(s.MergeBase))
	}
	return strings.Join(parts, " ")
}

func shortRev(rev string) string {
	if !isHex(rev) || len(rev) < 40 {
		return rev
	}
	return rev[:12]
}

func isHex(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'f', r >= 'A' && r <= 'F':
		default:
			return false
		}
	}
	return true
}

func describeCounts(comments []model.Comment) string {
	var stale int
	for _, c := range comments {
		if c.ResolvedAnchor != nil && c.ResolvedAnchor.Stale {
			stale++
		}
	}
	head := fmt.Sprintf("%d comments", len(comments))
	if len(comments) == 1 {
		head = "1 comment"
	}
	if stale == 0 {
		return head
	}
	return fmt.Sprintf("%s (%d stale)", head, stale)
}

func oneLine(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.Join(strings.Split(strings.TrimSpace(s), "\n"), " ")
}
