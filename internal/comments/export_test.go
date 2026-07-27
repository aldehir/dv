package comments

import (
	"strings"
	"testing"

	"github.com/alde/dv/internal/model"
)

func goldenDoc() *model.CommentsDoc {
	return &model.CommentsDoc{
		Version:   model.SchemaVersion,
		Generator: "dv/0.1.0",
		Repo: model.RepoRef{
			Root: "/home/alde/dev/alde/dv",
			Head: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
		},
		Spec: model.Spec{
			Kind:  model.SpecTwoDot,
			Left:  "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
			Right: "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70819203",
			Argv:  []string{"main", "feature"},
		},
		UpdatedAt: "2026-07-26T18:04:11Z",
		Comments: []model.Comment{
			{
				ID:        "cmt_01J8ZQ4K",
				Author:    model.Author{Name: "Alde Rojas", Email: "alde@example.com"},
				CreatedAt: "2026-07-26T18:00:00Z",
				UpdatedAt: "2026-07-26T18:03:00Z",
				Body:      "This retries forever if the context is already cancelled.",
				Anchor: model.Anchor{
					Path:          "internal/gitx/blob.go",
					Side:          model.SideAdditions,
					StartLine:     8,
					EndLine:       9,
					BlobSha:       "e5f6a7b8",
					Lang:          "go",
					Quote:         quote,
					ContextBefore: []string{"func (r *Reader) drain() error {"},
					ContextAfter:  []string{"\t\t\treturn err"},
				},
				ResolvedAnchor: &model.ResolvedAnchor{
					MovedFrom: &model.MovedFrom{StartLine: 4, EndLine: 5},
					Rule:      RuleQuote,
				},
				Replies: []model.Reply{{
					ID:        "rpl_01J8ZQ7P",
					Author:    model.Author{Name: "agent"},
					CreatedAt: "2026-07-26T18:03:00Z",
					Body:      "Fixed in 3f1a — added a ctx.Err() check.\nAlso added a test.",
				}},
			},
			{
				ID:        "cmt_01J8ZQ5M",
				Author:    model.Author{Name: "Alde Rojas"},
				CreatedAt: "2026-07-26T18:01:00Z",
				UpdatedAt: "2026-07-26T18:02:00Z",
				Body:      "Dead code.",
				Anchor: model.Anchor{
					Path:          "web/src/main.ts",
					Side:          model.SideDeletions,
					StartLine:     9,
					EndLine:       9,
					Quote:         "const unused = 1;\n",
					ContextBefore: []string{},
					ContextAfter:  []string{},
				},
				ResolvedAnchor: &model.ResolvedAnchor{Stale: true, Rule: RuleGone},
				Replies:        []model.Reply{},
			},
		},
	}
}

func diffText(t *testing.T, got, want string) {
	t.Helper()
	gotLines := strings.Split(got, "\n")
	wantLines := strings.Split(want, "\n")
	for i := 0; i < len(gotLines) || i < len(wantLines); i++ {
		g, w := "<eof>", "<eof>"
		if i < len(gotLines) {
			g = gotLines[i]
		}
		if i < len(wantLines) {
			w = wantLines[i]
		}
		if g != w {
			t.Errorf("line %d:\n got: %q\nwant: %q", i+1, g, w)
		}
	}
}

func TestExportMarkdownGolden(t *testing.T) {
	var b strings.Builder
	if err := ExportMarkdown(goldenDoc(), &b); err != nil {
		t.Fatalf("ExportMarkdown: %v", err)
	}
	want := "# Review comments\n" +
		"\n" +
		"- Repo: /home/alde/dev/alde/dv\n" +
		"- Head: a1b2c3d4e5f6\n" +
		"- Diff: two-dot `main feature` (9f8e7d6c5b4a..1c2d3e4f5a6b)\n" +
		"- Generator: dv/0.1.0\n" +
		"- Updated: 2026-07-26T18:04:11Z\n" +
		"- Comments: 2 comments (1 stale)\n" +
		"\n" +
		"## internal/gitx/blob.go:8-9\n" +
		"\n" +
		"- Side: additions (new)\n" +
		"- Language: go\n" +
		"- Author: Alde Rojas <alde@example.com>\n" +
		"- Created: 2026-07-26T18:00:00Z\n" +
		"- Anchor moved from lines 4-5 (rule: quote)\n" +
		"\n" +
		"```\n" +
		"8 | \tfor {\n" +
		"9 | \t\tif err := r.next(); err != nil {\n" +
		"```\n" +
		"\n" +
		"This retries forever if the context is already cancelled.\n" +
		"\n" +
		"### Replies\n" +
		"\n" +
		"- **agent** (2026-07-26T18:03:00Z): Fixed in 3f1a — added a ctx.Err() check. Also added a test.\n" +
		"\n" +
		"## web/src/main.ts:9\n" +
		"\n" +
		"- Side: deletions (old)\n" +
		"- Author: Alde Rojas\n" +
		"- Created: 2026-07-26T18:01:00Z\n" +
		"- Anchor is stale (rule: gone) — the line numbers may be wrong, find the code by the quoted lines\n" +
		"\n" +
		"```\n" +
		"9 | const unused = 1;\n" +
		"```\n" +
		"\n" +
		"Dead code.\n"
	if b.String() != want {
		diffText(t, b.String(), want)
	}
}

func TestExportPromptGolden(t *testing.T) {
	var b strings.Builder
	if err := ExportPrompt(goldenDoc(), &b); err != nil {
		t.Fatalf("ExportPrompt: %v", err)
	}
	want := "# Code review comments\n" +
		"\n" +
		"Repo: /home/alde/dev/alde/dv\n" +
		"Diff: two-dot `main feature` (9f8e7d6c5b4a..1c2d3e4f5a6b)\n" +
		"Head: a1b2c3d4e5f6\n" +
		"\n" +
		"2 comments (1 stale) follow.\n" +
		"\n" +
		"Each comment gives a file, a line range on one side of the diff, the exact\n" +
		"lines it refers to prefixed with their real line numbers, and the reviewer's\n" +
		"note. Address each note, then append a reply in comments.json saying what\n" +
		"you changed.\n" +
		"\n" +
		"## 1. internal/gitx/blob.go lines 8-9 (new side, go)\n" +
		"\n" +
		"Anchor moved from lines 4-5 (rule: quote).\n" +
		"\n" +
		"```\n" +
		"8 | \tfor {\n" +
		"9 | \t\tif err := r.next(); err != nil {\n" +
		"```\n" +
		"\n" +
		"This retries forever if the context is already cancelled.\n" +
		"\n" +
		"Replies:\n" +
		"- agent: Fixed in 3f1a — added a ctx.Err() check. Also added a test.\n" +
		"\n" +
		"## 2. web/src/main.ts line 9 (old side)\n" +
		"\n" +
		"Anchor is stale (rule: gone) — the line numbers may be wrong, find the code by the quoted lines.\n" +
		"\n" +
		"```\n" +
		"9 | const unused = 1;\n" +
		"```\n" +
		"\n" +
		"Dead code.\n"
	if b.String() != want {
		diffText(t, b.String(), want)
	}
}

func TestExportJSONGolden(t *testing.T) {
	var b strings.Builder
	if err := ExportJSON(goldenDoc(), &b); err != nil {
		t.Fatalf("ExportJSON: %v", err)
	}
	want := `{
  "version": 1,
  "generator": "dv/0.1.0",
  "repo": {
    "root": "/home/alde/dev/alde/dv",
    "head": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
  },
  "spec": {
    "kind": "two-dot",
    "left": "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
    "right": "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70819203",
    "argv": [
      "main",
      "feature"
    ]
  },
  "updatedAt": "2026-07-26T18:04:11Z",
  "comments": [
    {
      "id": "cmt_01J8ZQ4K",
      "author": {
        "name": "Alde Rojas",
        "email": "alde@example.com"
      },
      "createdAt": "2026-07-26T18:00:00Z",
      "updatedAt": "2026-07-26T18:03:00Z",
      "body": "This retries forever if the context is already cancelled.",
      "anchor": {
        "path": "internal/gitx/blob.go",
        "prevPath": null,
        "side": "additions",
        "startLine": 8,
        "endLine": 9,
        "blobSha": "e5f6a7b8",
        "lang": "go",
        "quote": "\tfor {\n\t\tif err := r.next(); err != nil {\n",
        "contextBefore": [
          "func (r *Reader) drain() error {"
        ],
        "contextAfter": [
          "\t\t\treturn err"
        ]
      },
      "resolvedAnchor": {
        "stale": false,
        "movedFrom": {
          "startLine": 4,
          "endLine": 5
        },
        "rule": "quote"
      },
      "replies": [
        {
          "id": "rpl_01J8ZQ7P",
          "author": {
            "name": "agent"
          },
          "createdAt": "2026-07-26T18:03:00Z",
          "body": "Fixed in 3f1a — added a ctx.Err() check.\nAlso added a test."
        }
      ]
    },
    {
      "id": "cmt_01J8ZQ5M",
      "author": {
        "name": "Alde Rojas"
      },
      "createdAt": "2026-07-26T18:01:00Z",
      "updatedAt": "2026-07-26T18:02:00Z",
      "body": "Dead code.",
      "anchor": {
        "path": "web/src/main.ts",
        "prevPath": null,
        "side": "deletions",
        "startLine": 9,
        "endLine": 9,
        "blobSha": "",
        "quote": "const unused = 1;\n",
        "contextBefore": [],
        "contextAfter": []
      },
      "resolvedAnchor": {
        "stale": true,
        "movedFrom": null,
        "rule": "gone"
      },
      "replies": []
    }
  ]
}
`
	if b.String() != want {
		diffText(t, b.String(), want)
	}
}

func TestExportsHandleAnEmptyDoc(t *testing.T) {
	doc := &model.CommentsDoc{Version: model.SchemaVersion, Comments: []model.Comment{}}
	for name, fn := range map[string]func(*model.CommentsDoc, *strings.Builder) error{
		"md":     func(d *model.CommentsDoc, b *strings.Builder) error { return ExportMarkdown(d, b) },
		"prompt": func(d *model.CommentsDoc, b *strings.Builder) error { return ExportPrompt(d, b) },
		"json":   func(d *model.CommentsDoc, b *strings.Builder) error { return ExportJSON(d, b) },
	} {
		t.Run(name, func(t *testing.T) {
			var b strings.Builder
			if err := fn(doc, &b); err != nil {
				t.Fatalf("export: %v", err)
			}
			if b.Len() == 0 {
				t.Fatal("export produced nothing")
			}
			if err := fn(nil, &b); err == nil {
				t.Fatal("a nil document should be an error")
			}
		})
	}
}

func TestExportQuoteFenceEscapesBackticks(t *testing.T) {
	doc := goldenDoc()
	doc.Comments = doc.Comments[:1]
	doc.Comments[0].Anchor.Quote = "md := \"```go\"\n"

	var b strings.Builder
	if err := ExportPrompt(doc, &b); err != nil {
		t.Fatalf("ExportPrompt: %v", err)
	}
	if !strings.Contains(b.String(), "````\n8 | md := \"```go\"\n````\n") {
		t.Errorf("fence not widened for embedded backticks:\n%s", b.String())
	}
}

func TestExportPromptNumbersWideRangesAligned(t *testing.T) {
	doc := goldenDoc()
	doc.Comments = doc.Comments[:1]
	doc.Comments[0].Anchor.StartLine = 99
	doc.Comments[0].Anchor.EndLine = 100

	var b strings.Builder
	if err := ExportPrompt(doc, &b); err != nil {
		t.Fatalf("ExportPrompt: %v", err)
	}
	if !strings.Contains(b.String(), " 99 | \tfor {\n100 | \t\tif err") {
		t.Errorf("line numbers not right-aligned:\n%s", b.String())
	}
}
