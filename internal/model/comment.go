package model

const SchemaVersion = 1

type AnnotationSide string

const (
	SideAdditions AnnotationSide = "additions"
	SideDeletions AnnotationSide = "deletions"
)

type CommentStatus string

const (
	CommentOpen     CommentStatus = "open"
	CommentResolved CommentStatus = "resolved"
	CommentWontFix  CommentStatus = "wontfix"
)

type Author struct {
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}

type RepoRef struct {
	Root string `json:"root"`
	Head string `json:"head"`
}

type Anchor struct {
	Path          string         `json:"path"`
	PrevPath      *string        `json:"prevPath"`
	Side          AnnotationSide `json:"side"`
	StartLine     int            `json:"startLine"`
	EndLine       int            `json:"endLine"`
	BlobSha       string         `json:"blobSha"`
	Lang          string         `json:"lang,omitempty"`
	Quote         string         `json:"quote"`
	ContextBefore []string       `json:"contextBefore"`
	ContextAfter  []string       `json:"contextAfter"`
}

type MovedFrom struct {
	StartLine int `json:"startLine"`
	EndLine   int `json:"endLine"`
}

type ResolvedAnchor struct {
	Stale     bool       `json:"stale"`
	MovedFrom *MovedFrom `json:"movedFrom"`
	Rule      string     `json:"rule,omitempty"`
}

type Reply struct {
	ID        string `json:"id"`
	Author    Author `json:"author"`
	CreatedAt string `json:"createdAt"`
	Body      string `json:"body"`
}

type Comment struct {
	ID             string          `json:"id"`
	Status         CommentStatus   `json:"status"`
	Author         Author          `json:"author"`
	CreatedAt      string          `json:"createdAt"`
	UpdatedAt      string          `json:"updatedAt"`
	Body           string          `json:"body"`
	Anchor         Anchor          `json:"anchor"`
	ResolvedAnchor *ResolvedAnchor `json:"resolvedAnchor,omitempty"`
	Replies        []Reply         `json:"replies"`
}

type CommentsDoc struct {
	Version   int       `json:"version"`
	Generator string    `json:"generator"`
	Repo      RepoRef   `json:"repo"`
	Spec      Spec      `json:"spec"`
	UpdatedAt string    `json:"updatedAt"`
	Comments  []Comment `json:"comments"`
}
