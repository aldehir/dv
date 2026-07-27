package model

type SpecKind string

const (
	SpecWorktree  SpecKind = "worktree"
	SpecStaged    SpecKind = "staged"
	SpecCommit    SpecKind = "commit"
	SpecTwoDot    SpecKind = "two-dot"
	SpecThreeDot  SpecKind = "three-dot"
	SpecMergeBase SpecKind = "merge-base"
)

type Spec struct {
	Kind      SpecKind `json:"kind"`
	Left      string   `json:"left"`
	Right     string   `json:"right"`
	MergeBase string   `json:"mergeBase,omitempty"`
	Argv      []string `json:"argv"`
}

type Defaults struct {
	Theme string `json:"theme"`
	View  string `json:"view"`
	Wrap  bool   `json:"wrap"`
}

type Session struct {
	RepoRoot string   `json:"repoRoot"`
	Head     string   `json:"head"`
	Spec     Spec     `json:"spec"`
	Argv     []string `json:"argv"`
	Defaults Defaults `json:"defaults"`
	Comments bool     `json:"comments"`
}

type Status string

const (
	StatusAdded      Status = "added"
	StatusCopied     Status = "copied"
	StatusDeleted    Status = "deleted"
	StatusModified   Status = "modified"
	StatusRenamed    Status = "renamed"
	StatusTypeChange Status = "typechange"
	StatusUnmerged   Status = "unmerged"
	StatusUntracked  Status = "untracked"
)

type Mode struct {
	Old string `json:"old"`
	New string `json:"new"`
}

type FileEntry struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	PrevPath  string `json:"prevPath,omitempty"`
	Status    Status `json:"status"`
	Score     int    `json:"score,omitempty"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Binary    bool   `json:"binary"`
	TooLarge  bool   `json:"tooLarge"`
	Submodule bool   `json:"submodule"`
	Symlink   bool   `json:"symlink"`
	Mode      Mode   `json:"mode"`
	OldSha    string `json:"oldSha"`
	NewSha    string `json:"newSha"`
}

type Totals struct {
	Files     int `json:"files"`
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
}

type Manifest struct {
	Files  []FileEntry `json:"files"`
	Totals Totals      `json:"totals"`
}

type FilePayload struct {
	ID        string   `json:"id"`
	Path      string   `json:"path"`
	PrevPath  string   `json:"prevPath,omitempty"`
	Status    Status   `json:"status"`
	Patch     string   `json:"patch"`
	OldLines  []string `json:"oldLines"`
	NewLines  []string `json:"newLines"`
	Binary    bool     `json:"binary"`
	TooLarge  bool     `json:"tooLarge"`
	OldSha    string   `json:"oldSha"`
	NewSha    string   `json:"newSha"`
	OldSize   int64    `json:"oldSize"`
	NewSize   int64    `json:"newSize"`
	Mode      Mode     `json:"mode"`
	Submodule bool     `json:"submodule"`
	Symlink   bool     `json:"symlink"`
}

type Error struct {
	Error  string `json:"error"`
	Detail string `json:"detail,omitempty"`
}
