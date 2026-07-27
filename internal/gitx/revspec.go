package gitx

import (
	"fmt"
	"os"
	"slices"
	"strings"

	"github.com/alde/dv/internal/model"
)

type RevSpec struct {
	Kind      model.SpecKind
	Left      string
	Right     string
	MergeBase string
	Argv      []string
	DiffOpts  []string
	Paths     []string
	Cached    bool
}

const ambiguousHint = "Use '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'"

func ambiguousRevAndFile(arg string) *FatalError {
	return fatalf("fatal: ambiguous argument '%s': both revision and filename\n%s", arg, ambiguousHint)
}

func unknownRevision(arg string) *FatalError {
	return fatalf("fatal: ambiguous argument '%s': unknown revision or path not in the working tree.\n%s", arg, ambiguousHint)
}

func ResolveSpec(r *Repo, args []string) (*RevSpec, error) {
	s := &RevSpec{Argv: slices.Clone(args), Kind: model.SpecWorktree}

	var positional []string
	var trailing []string
	sawDashDash := false
	mergeBaseFlag := false

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			sawDashDash = true
			trailing = slices.Clone(args[i+1:])
			break
		}
		if len(arg) > 1 && strings.HasPrefix(arg, "-") {
			switch arg {
			case "--cached", "--staged":
				s.Cached = true
			case "--merge-base":
				mergeBaseFlag = true
			default:
				s.DiffOpts = append(s.DiffOpts, arg)
			}
			continue
		}
		positional = append(positional, arg)
	}

	revs, rest, err := r.splitRevsAndPaths(positional)
	if err != nil {
		return nil, err
	}

	if sawDashDash {
		if len(rest) > 0 {
			return nil, unknownRevision(rest[0])
		}
		s.Paths = trailing
	} else {
		for _, rev := range revs {
			if pathExists(r, rev) {
				return nil, ambiguousRevAndFile(rev)
			}
		}
		for _, p := range rest {
			if !looksLikePathspec(p) && !pathExists(r, p) {
				return nil, unknownRevision(p)
			}
		}
		s.Paths = rest
	}

	if err := s.classify(r, revs, mergeBaseFlag); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *RevSpec) classify(r *Repo, revs []string, mergeBaseFlag bool) error {
	if mergeBaseFlag {
		return s.classifyMergeBase(r, revs)
	}

	switch len(revs) {
	case 0:
		if s.Cached {
			s.Kind = model.SpecStaged
			head, err := r.Head()
			if err != nil {
				return err
			}
			s.Left = head
			return nil
		}
		s.Kind = model.SpecWorktree
		return nil
	case 1:
		return s.classifySingle(r, revs[0])
	case 2:
		left, err := r.resolveCommit(revs[0])
		if err != nil {
			return err
		}
		right, err := r.resolveCommit(revs[1])
		if err != nil {
			return err
		}
		s.Kind = model.SpecTwoDot
		s.Left, s.Right = left, right
		return nil
	default:
		return fatalf("fatal: too many revisions specified: '%s'", strings.Join(revs, " "))
	}
}

func (s *RevSpec) classifySingle(r *Repo, arg string) error {
	if a, b, kind, ok := splitRange(arg); ok {
		left, err := r.resolveCommit(a)
		if err != nil {
			return err
		}
		right, err := r.resolveCommit(b)
		if err != nil {
			return err
		}
		s.Kind = kind
		s.Left, s.Right = left, right
		if kind == model.SpecThreeDot {
			base, err := r.mergeBase(a, b)
			if err != nil {
				return err
			}
			s.MergeBase = base
		}
		return nil
	}

	resolved, err := r.resolveCommit(arg)
	if err != nil {
		return err
	}
	if s.Cached {
		s.Kind = model.SpecStaged
		s.Left = resolved
		return nil
	}
	s.Kind = model.SpecCommit
	s.Left = resolved
	return nil
}

func (s *RevSpec) classifyMergeBase(r *Repo, revs []string) error {
	switch len(revs) {
	case 1:
		left, err := r.resolveCommit(revs[0])
		if err != nil {
			return err
		}
		base, err := r.mergeBase(revs[0], "HEAD")
		if err != nil {
			return err
		}
		s.Kind = model.SpecMergeBase
		s.Left = left
		s.MergeBase = base
		return nil
	case 2:
		left, err := r.resolveCommit(revs[0])
		if err != nil {
			return err
		}
		right, err := r.resolveCommit(revs[1])
		if err != nil {
			return err
		}
		base, err := r.mergeBase(revs[0], revs[1])
		if err != nil {
			return err
		}
		s.Kind = model.SpecMergeBase
		s.Left, s.Right = left, right
		s.MergeBase = base
		return nil
	default:
		return fatalf("fatal: --merge-base requires one or two commits")
	}
}

func (r *Repo) splitRevsAndPaths(positional []string) (revs, rest []string, err error) {
	for i, arg := range positional {
		ok, err := r.isCommitish(arg)
		if err != nil {
			return nil, nil, err
		}
		if !ok {
			return revs, slices.Clone(positional[i:]), nil
		}
		revs = append(revs, arg)
	}
	return revs, nil, nil
}

func splitRange(arg string) (left, right string, kind model.SpecKind, ok bool) {
	if i := strings.Index(arg, "..."); i >= 0 {
		return defaultHead(arg[:i]), defaultHead(arg[i+3:]), model.SpecThreeDot, true
	}
	if i := strings.Index(arg, ".."); i >= 0 {
		return defaultHead(arg[:i]), defaultHead(arg[i+2:]), model.SpecTwoDot, true
	}
	return "", "", "", false
}

func defaultHead(s string) string {
	if s == "" {
		return "HEAD"
	}
	return s
}

func (r *Repo) isCommitish(arg string) (bool, error) {
	if arg == "" {
		return false, nil
	}
	if a, b, _, ok := splitRange(arg); ok {
		leftOK, err := r.verifyCommit(a)
		if err != nil || !leftOK {
			return false, err
		}
		return r.verifyCommit(b)
	}
	return r.verifyCommit(arg)
}

func (r *Repo) verifyCommit(rev string) (bool, error) {
	out, err := r.runOK([]int{1, 128}, "rev-parse", "--verify", "--quiet", rev+"^{commit}")
	if err != nil {
		return false, err
	}
	return strings.TrimRight(string(out), "\n") != "", nil
}

func (r *Repo) resolveCommit(rev string) (string, error) {
	out, err := r.runOK([]int{1, 128}, "rev-parse", "--verify", "--quiet", rev+"^{commit}")
	if err != nil {
		return "", err
	}
	sha := strings.TrimRight(string(out), "\n")
	if sha == "" {
		return "", unknownRevision(rev)
	}
	return sha, nil
}

func (r *Repo) mergeBase(a, b string) (string, error) {
	out, err := r.runOK([]int{1}, "merge-base", a, b)
	if err != nil {
		return "", err
	}
	base := strings.TrimRight(string(out), "\n")
	if base == "" {
		return "", fatalf("fatal: no merge base found between '%s' and '%s'", a, b)
	}
	return base, nil
}

func looksLikePathspec(arg string) bool {
	if strings.HasPrefix(arg, ":") {
		return true
	}
	escaped := false
	for _, c := range arg {
		switch {
		case escaped:
			escaped = false
		case c == '\\':
			escaped = true
		case c == '*' || c == '?' || c == '[':
			return true
		}
	}
	return false
}

func pathExists(r *Repo, arg string) bool {
	if arg == "" {
		return false
	}
	_, err := os.Lstat(r.worktreePath(arg))
	return err == nil
}

func (s *RevSpec) Model() model.Spec {
	return model.Spec{
		Kind:      s.Kind,
		Left:      s.Left,
		Right:     s.Right,
		MergeBase: s.MergeBase,
		Argv:      s.Argv,
	}
}

func (s *RevSpec) revArgs() []string {
	switch s.Kind {
	case model.SpecStaged:
		if s.Left == "" {
			return []string{"--cached"}
		}
		return []string{"--cached", s.Left}
	case model.SpecCommit:
		return []string{s.Left}
	case model.SpecTwoDot:
		return []string{s.Left, s.Right}
	case model.SpecThreeDot, model.SpecMergeBase:
		if s.Right == "" {
			return []string{s.MergeBase}
		}
		return []string{s.MergeBase, s.Right}
	default:
		return nil
	}
}

type sideKind int

const (
	sideNone sideKind = iota
	sideIndex
	sideWorktree
	sideTree
)

type sideSource struct {
	kind sideKind
	rev  string
}

func (src sideSource) objectSpec(path string) (string, bool) {
	switch src.kind {
	case sideIndex:
		return ":" + path, true
	case sideTree:
		return src.rev + ":" + path, true
	default:
		return "", false
	}
}

func (s *RevSpec) leftSide() sideSource {
	switch s.Kind {
	case model.SpecWorktree:
		return sideSource{kind: sideIndex}
	case model.SpecThreeDot, model.SpecMergeBase:
		return sideSource{kind: sideTree, rev: s.MergeBase}
	}
	if s.Left == "" {
		return sideSource{kind: sideNone}
	}
	return sideSource{kind: sideTree, rev: s.Left}
}

func (s *RevSpec) rightSide() sideSource {
	if s.Kind == model.SpecStaged {
		return sideSource{kind: sideIndex}
	}
	if s.Right == "" {
		return sideSource{kind: sideWorktree}
	}
	return sideSource{kind: sideTree, rev: s.Right}
}

func (s *RevSpec) rightIsWorktree() bool {
	return s.rightSide().kind == sideWorktree
}

func (r *Repo) diffArgv(s *RevSpec, o Options, format []string, paths []string) []string {
	args := []string{"diff", "--no-color", "--no-ext-diff", "--no-textconv"}
	args = append(args, s.DiffOpts...)
	if o.Context > 0 && !hasUnifiedOpt(s.DiffOpts) {
		args = append(args, fmt.Sprintf("-U%d", o.Context))
	}
	args = append(args, "--no-patch")
	args = append(args, format...)
	args = append(args, s.revArgs()...)
	args = append(args, "--")
	args = append(args, paths...)
	return args
}

func hasUnifiedOpt(opts []string) bool {
	for _, o := range opts {
		if strings.HasPrefix(o, "-U") || strings.HasPrefix(o, "--unified") {
			return true
		}
	}
	return false
}

func literalPathspec(path string) string {
	return ":(top,literal)" + path
}
