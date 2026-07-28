package gitx

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
)

const DefaultMaxBlob = 2 << 20

const ZeroSha = "0000000000000000000000000000000000000000"

var ErrNotFound = errors.New("path not present on that side")

type Repo struct {
	Root   string
	GitDir string
	Cwd    string
}

type Options struct {
	MaxBlob   int64
	Untracked bool
	Context   int
}

func (o Options) maxBlob() int64 {
	if o.MaxBlob <= 0 {
		return DefaultMaxBlob
	}
	return o.MaxBlob
}

type FatalError struct {
	Message  string
	ExitCode int
}

func (e *FatalError) Error() string { return e.Message }

func fatalf(format string, a ...any) *FatalError {
	return &FatalError{Message: fmt.Sprintf(format, a...), ExitCode: 128}
}

var globalGitArgs = []string{"--no-optional-locks", "-c", "core.quotePath=false"}

func execGit(dir string, okCodes []int, args ...string) ([]byte, error) {
	cmd := exec.Command("git", append(slices.Clone(globalGitArgs), args...)...)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err == nil {
		return stdout.Bytes(), nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code := exitErr.ExitCode()
		if slices.Contains(okCodes, code) {
			return stdout.Bytes(), nil
		}
		msg := strings.TrimRight(stderr.String(), "\n")
		if msg == "" {
			msg = fmt.Sprintf("fatal: git %s exited with status %d", strings.Join(args, " "), code)
		}
		return stdout.Bytes(), &FatalError{Message: msg, ExitCode: 128}
	}
	return stdout.Bytes(), &FatalError{Message: fmt.Sprintf("fatal: cannot run git: %v", err), ExitCode: 128}
}

func Open(cwd string) (*Repo, error) {
	if cwd == "" {
		wd, err := os.Getwd()
		if err != nil {
			return nil, fatalf("fatal: cannot determine working directory: %v", err)
		}
		cwd = wd
	}
	top, err := execGit(cwd, nil, "rev-parse", "--show-toplevel")
	if err != nil {
		return nil, err
	}
	root := strings.TrimRight(string(top), "\n")
	if root == "" {
		return nil, fatalf("fatal: this operation must be run in a work tree")
	}
	gitDir, err := execGit(root, nil, "rev-parse", "--absolute-git-dir")
	if err != nil {
		return nil, err
	}
	return &Repo{Root: root, GitDir: strings.TrimRight(string(gitDir), "\n"), Cwd: cwd}, nil
}

func (r *Repo) workDir() string {
	if r.Cwd != "" {
		return r.Cwd
	}
	return r.Root
}

func (r *Repo) run(args ...string) ([]byte, error) {
	return execGit(r.workDir(), nil, args...)
}

func (r *Repo) runOK(okCodes []int, args ...string) ([]byte, error) {
	return execGit(r.workDir(), okCodes, args...)
}

func (r *Repo) cwdPath(path string) string {
	return filepath.Join(r.workDir(), filepath.FromSlash(path))
}

func (r *Repo) Head() (string, error) {
	out, err := r.runOK([]int{1}, "rev-parse", "--verify", "--quiet", "HEAD^{commit}")
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(out), "\n"), nil
}

func (r *Repo) worktreePath(path string) string {
	return filepath.Join(r.Root, filepath.FromSlash(path))
}

func isZeroSha(sha string) bool {
	if sha == "" {
		return true
	}
	return strings.Trim(sha, "0") == ""
}

func splitLines(b []byte) []string {
	if len(b) == 0 {
		return []string{}
	}
	s := string(b)
	s = strings.TrimSuffix(s, "\n")
	return strings.Split(s, "\n")
}

func looksBinary(b []byte) bool {
	if len(b) > 8000 {
		b = b[:8000]
	}
	return bytes.IndexByte(b, 0) >= 0
}

func splitNUL(b []byte) []string {
	if len(b) == 0 {
		return nil
	}
	parts := strings.Split(string(b), "\x00")
	if len(parts) > 0 && parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	return parts
}
