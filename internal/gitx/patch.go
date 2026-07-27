package gitx

import (
	"errors"
	"fmt"
	"os"

	"github.com/alde/dv/internal/model"
)

type diffSide int

const (
	sideOld diffSide = iota
	sideNew
)

type sideLocator struct {
	spec     string
	worktree string
	empty    bool
}

func (s *RevSpec) locate(e model.FileEntry, which diffSide) sideLocator {
	if e.Submodule {
		return sideLocator{}
	}
	switch {
	case which == sideOld && (e.Status == model.StatusAdded || e.Status == model.StatusUntracked):
		return sideLocator{empty: true}
	case which == sideNew && e.Status == model.StatusDeleted:
		return sideLocator{empty: true}
	}

	sha := e.OldSha
	src := s.leftSide()
	if which == sideNew {
		sha = e.NewSha
		src = s.rightSide()
	}
	if !isZeroSha(sha) {
		return sideLocator{spec: sha}
	}
	switch src.kind {
	case sideNone:
		return sideLocator{empty: true}
	case sideWorktree:
		return sideLocator{worktree: e.Path}
	default:
		spec, ok := src.objectSpec(e.Path)
		if !ok {
			return sideLocator{}
		}
		return sideLocator{spec: spec}
	}
}

func (r *Repo) File(s *RevSpec, e model.FileEntry, o Options) (*model.FilePayload, error) {
	p := &model.FilePayload{
		ID:        e.ID,
		Path:      e.Path,
		PrevPath:  e.PrevPath,
		Status:    e.Status,
		Binary:    e.Binary,
		TooLarge:  e.TooLarge,
		OldSha:    e.OldSha,
		NewSha:    e.NewSha,
		Mode:      e.Mode,
		Submodule: e.Submodule,
		Symlink:   e.Symlink,
	}

	patch, err := r.patchFor(s, e, o)
	if err != nil {
		return nil, err
	}
	p.Patch = patch

	oldLoc := s.locate(e, sideOld)
	newLoc := s.locate(e, sideNew)

	var specs []string
	if oldLoc.spec != "" {
		specs = append(specs, oldLoc.spec)
	}
	if newLoc.spec != "" {
		specs = append(specs, newLoc.spec)
	}
	sizes, err := r.blobSizes(specs)
	if err != nil {
		return nil, err
	}

	oldSize, err := r.sideSize(oldLoc, sizes)
	if err != nil {
		return nil, err
	}
	newSize, err := r.sideSize(newLoc, sizes)
	if err != nil {
		return nil, err
	}
	p.OldSize, p.NewSize = oldSize, newSize

	max := o.maxBlob()
	if oldSize > max || newSize > max {
		p.TooLarge = true
	}
	if p.Binary || p.TooLarge || e.Submodule {
		return p, nil
	}

	objs, err := r.catFileBatch(specs)
	if err != nil {
		return nil, err
	}
	oldContent, err := r.sideContentBytes(oldLoc, objs)
	if err != nil {
		return nil, err
	}
	newContent, err := r.sideContentBytes(newLoc, objs)
	if err != nil {
		return nil, err
	}
	if looksBinary(oldContent) || looksBinary(newContent) {
		return p, nil
	}
	if oldContent != nil {
		p.OldLines = splitLines(oldContent)
	}
	if newContent != nil {
		p.NewLines = splitLines(newContent)
	}
	return p, nil
}

func (r *Repo) sideSize(loc sideLocator, sizes map[string]int64) (int64, error) {
	switch {
	case loc.spec != "":
		return sizes[loc.spec], nil
	case loc.worktree != "":
		info, err := os.Lstat(r.worktreePath(loc.worktree))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return 0, nil
			}
			return 0, err
		}
		return info.Size(), nil
	default:
		return 0, nil
	}
}

func (r *Repo) sideContentBytes(loc sideLocator, objs map[string]catObject) ([]byte, error) {
	switch {
	case loc.empty:
		return []byte{}, nil
	case loc.spec != "":
		obj, ok := objs[loc.spec]
		if !ok {
			return nil, nil
		}
		return obj.Data, nil
	case loc.worktree != "":
		return r.readWorktree(loc.worktree)
	default:
		return nil, nil
	}
}

func (r *Repo) readWorktree(path string) ([]byte, error) {
	full := r.worktreePath(path)
	info, err := os.Lstat(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(full)
		if err != nil {
			return nil, err
		}
		return []byte(target), nil
	}
	if !info.Mode().IsRegular() {
		return nil, nil
	}
	return os.ReadFile(full)
}

func (r *Repo) patchFor(s *RevSpec, e model.FileEntry, o Options) (string, error) {
	if e.Status == model.StatusUntracked {
		return r.untrackedPatch(e.Path, o)
	}
	paths := []string{literalPathspec(e.Path)}
	if e.PrevPath != "" {
		paths = append(paths, literalPathspec(e.PrevPath))
	}
	out, err := r.run(r.diffArgv(s, o, []string{"--patch"}, paths)...)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func (r *Repo) untrackedPatch(path string, o Options) (string, error) {
	args := []string{"diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-index"}
	if o.Context > 0 {
		args = append(args, fmt.Sprintf("-U%d", o.Context))
	}
	args = append(args, "--", os.DevNull, path)
	out, err := r.runOK([]int{1}, args...)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
