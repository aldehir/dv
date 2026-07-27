package gitx

import (
	"cmp"
	"encoding/base64"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/alde/dv/internal/model"
)

type rawEntry struct {
	OldMode  string
	NewMode  string
	OldSha   string
	NewSha   string
	Status   byte
	Score    int
	Path     string
	PrevPath string
}

func parseRaw(data []byte) ([]rawEntry, error) {
	tokens := splitNUL(data)
	var entries []rawEntry
	for i := 0; i < len(tokens); {
		head := tokens[i]
		if !strings.HasPrefix(head, ":") {
			return nil, fatalf("fatal: cannot parse git diff --raw record %q", head)
		}
		fields := strings.Fields(head[1:])
		if len(fields) < 5 {
			return nil, fatalf("fatal: cannot parse git diff --raw record %q", head)
		}
		status := fields[4]
		e := rawEntry{
			OldMode: fields[0],
			NewMode: fields[1],
			OldSha:  fields[2],
			NewSha:  fields[3],
			Status:  status[0],
		}
		if len(status) > 1 {
			if n, err := strconv.Atoi(status[1:]); err == nil {
				e.Score = n
			}
		}
		want := 1
		if e.Status == 'R' || e.Status == 'C' {
			want = 2
		}
		if i+want >= len(tokens) {
			return nil, fatalf("fatal: truncated git diff --raw output")
		}
		if want == 2 {
			e.PrevPath = tokens[i+1]
			e.Path = tokens[i+2]
		} else {
			e.Path = tokens[i+1]
		}
		entries = append(entries, e)
		i += 1 + want
	}
	return entries, nil
}

type numstatEntry struct {
	Additions int
	Deletions int
	Binary    bool
	Path      string
	PrevPath  string
}

func parseNumstat(data []byte) ([]numstatEntry, error) {
	tokens := splitNUL(data)
	var entries []numstatEntry
	for i := 0; i < len(tokens); {
		head := tokens[i]
		parts := strings.SplitN(head, "\t", 3)
		if len(parts) < 3 {
			return nil, fatalf("fatal: cannot parse git diff --numstat record %q", head)
		}
		e := numstatEntry{Binary: parts[0] == "-" || parts[1] == "-"}
		if !e.Binary {
			add, err1 := strconv.Atoi(parts[0])
			del, err2 := strconv.Atoi(parts[1])
			if err1 != nil || err2 != nil {
				return nil, fatalf("fatal: cannot parse git diff --numstat record %q", head)
			}
			e.Additions, e.Deletions = add, del
		}
		if parts[2] != "" {
			e.Path = parts[2]
			i++
		} else {
			if i+2 >= len(tokens) {
				return nil, fatalf("fatal: truncated git diff --numstat output")
			}
			e.PrevPath = tokens[i+1]
			e.Path = tokens[i+2]
			i += 3
		}
		entries = append(entries, e)
	}
	return entries, nil
}

func statusFromLetter(c byte) model.Status {
	switch c {
	case 'A':
		return model.StatusAdded
	case 'C':
		return model.StatusCopied
	case 'D':
		return model.StatusDeleted
	case 'R':
		return model.StatusRenamed
	case 'T':
		return model.StatusTypeChange
	case 'U':
		return model.StatusUnmerged
	default:
		return model.StatusModified
	}
}

func FileID(path string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(path))
}

func PathFromFileID(id string) (string, error) {
	b, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return "", fatalf("fatal: invalid file id %q", id)
	}
	return string(b), nil
}

func (r *Repo) Manifest(s *RevSpec, o Options) (*model.Manifest, error) {
	rawOut, err := r.run(r.diffArgv(s, o, []string{"--raw", "-z", "--no-abbrev"}, s.Paths)...)
	if err != nil {
		return nil, err
	}
	numOut, err := r.run(r.diffArgv(s, o, []string{"--numstat", "-z"}, s.Paths)...)
	if err != nil {
		return nil, err
	}
	raws, err := parseRaw(rawOut)
	if err != nil {
		return nil, err
	}
	nums, err := parseNumstat(numOut)
	if err != nil {
		return nil, err
	}

	stats := make(map[string]numstatEntry, len(nums))
	for _, n := range nums {
		if prev, ok := stats[n.Path]; ok {
			n.Additions += prev.Additions
			n.Deletions += prev.Deletions
			n.Binary = n.Binary || prev.Binary
		}
		stats[n.Path] = n
	}

	files := make([]model.FileEntry, 0, len(raws))
	seen := make(map[string]bool, len(raws))
	for _, raw := range raws {
		if seen[raw.Path] {
			continue
		}
		seen[raw.Path] = true
		entry := model.FileEntry{
			ID:        FileID(raw.Path),
			Path:      raw.Path,
			PrevPath:  raw.PrevPath,
			Status:    statusFromLetter(raw.Status),
			Score:     raw.Score,
			Mode:      model.Mode{Old: raw.OldMode, New: raw.NewMode},
			OldSha:    raw.OldSha,
			NewSha:    raw.NewSha,
			Submodule: raw.OldMode == "160000" || raw.NewMode == "160000",
			Symlink:   raw.OldMode == "120000" || raw.NewMode == "120000",
		}
		if st, ok := stats[raw.Path]; ok {
			entry.Additions = st.Additions
			entry.Deletions = st.Deletions
			entry.Binary = st.Binary
		}
		files = append(files, entry)
	}

	if o.Untracked && s.rightIsWorktree() {
		extra, err := r.untrackedEntries(s, o)
		if err != nil {
			return nil, err
		}
		for _, e := range extra {
			if seen[e.Path] {
				continue
			}
			seen[e.Path] = true
			files = append(files, e)
		}
	}

	if err := r.annotateSizes(s, files, o); err != nil {
		return nil, err
	}

	slices.SortStableFunc(files, func(a, b model.FileEntry) int {
		return cmp.Compare(a.Path, b.Path)
	})

	m := &model.Manifest{Files: files}
	m.Totals.Files = len(files)
	for _, f := range files {
		m.Totals.Additions += f.Additions
		m.Totals.Deletions += f.Deletions
	}
	return m, nil
}

func (r *Repo) untrackedEntries(s *RevSpec, o Options) ([]model.FileEntry, error) {
	args := []string{"ls-files", "--others", "--exclude-standard", "-z", "--"}
	args = append(args, s.Paths...)
	out, err := r.run(args...)
	if err != nil {
		return nil, err
	}
	paths := splitNUL(out)
	entries := make([]model.FileEntry, 0, len(paths))
	for _, path := range paths {
		info, err := os.Lstat(r.worktreePath(path))
		if err != nil {
			continue
		}
		entry := model.FileEntry{
			ID:      FileID(path),
			Path:    path,
			Status:  model.StatusUntracked,
			Mode:    model.Mode{Old: "000000", New: worktreeMode(info)},
			OldSha:  ZeroSha,
			NewSha:  ZeroSha,
			Symlink: info.Mode()&os.ModeSymlink != 0,
		}
		if info.Mode().IsRegular() && info.Size() <= o.maxBlob() {
			content, err := os.ReadFile(r.worktreePath(path))
			if err == nil {
				if looksBinary(content) {
					entry.Binary = true
				} else {
					entry.Additions = len(splitLines(content))
				}
			}
		} else if info.Mode().IsRegular() {
			entry.TooLarge = true
		} else if entry.Symlink {
			entry.Additions = 1
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func worktreeMode(info os.FileInfo) string {
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		return "120000"
	case info.IsDir():
		return "160000"
	case info.Mode().Perm()&0o100 != 0:
		return "100755"
	default:
		return "100644"
	}
}

func (r *Repo) annotateSizes(s *RevSpec, files []model.FileEntry, o Options) error {
	specs := make([]string, 0, len(files)*2)
	for _, f := range files {
		if !isZeroSha(f.OldSha) {
			specs = append(specs, f.OldSha)
		}
		if !isZeroSha(f.NewSha) {
			specs = append(specs, f.NewSha)
		}
	}
	sizes, err := r.blobSizes(specs)
	if err != nil {
		return err
	}
	rightWorktree := s.rightIsWorktree()
	max := o.maxBlob()
	for i := range files {
		f := &files[i]
		if f.Submodule {
			continue
		}
		oldSize := sizes[f.OldSha]
		newSize, ok := sizes[f.NewSha]
		if !ok && isZeroSha(f.NewSha) && rightWorktree && f.Status != model.StatusDeleted {
			if info, err := os.Lstat(r.worktreePath(f.Path)); err == nil && info.Mode().IsRegular() {
				newSize = info.Size()
			}
		}
		if oldSize > max || newSize > max {
			f.TooLarge = true
		}
	}
	return nil
}
