package gitx

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"

	"github.com/alde/dv/internal/model"
)

type catObject struct {
	Sha  string
	Type string
	Size int64
	Data []byte
}

func (r *Repo) Blob(sha string) ([]byte, error) {
	if isZeroSha(sha) {
		return nil, fmt.Errorf("blob %q: %w", sha, ErrNotFound)
	}
	objs, err := r.catFileBatch([]string{sha})
	if err != nil {
		return nil, err
	}
	obj, ok := objs[sha]
	if !ok {
		return nil, fmt.Errorf("blob %s: %w", sha, ErrNotFound)
	}
	return obj.Data, nil
}

func dedupe(specs []string) []string {
	out := make([]string, 0, len(specs))
	seen := make(map[string]bool, len(specs))
	for _, s := range specs {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func (r *Repo) batch(args []string, specs []string, readData bool) (map[string]catObject, error) {
	specs = dedupe(specs)
	result := make(map[string]catObject, len(specs))
	if len(specs) == 0 {
		return result, nil
	}

	cmd := exec.Command("git", append(slices.Clone(globalGitArgs), args...)...)
	cmd.Dir = r.Root
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fatalf("fatal: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fatalf("fatal: %v", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fatalf("fatal: cannot run git: %v", err)
	}

	go func() {
		w := bufio.NewWriter(stdin)
		for _, s := range specs {
			fmt.Fprintf(w, "%s\n", s)
		}
		w.Flush()
		stdin.Close()
	}()

	reader := bufio.NewReader(stdout)
	var readErr error
	for _, spec := range specs {
		line, err := reader.ReadString('\n')
		if err != nil {
			if !errors.Is(err, io.EOF) || line == "" {
				readErr = err
				break
			}
		}
		fields := strings.Fields(strings.TrimRight(line, "\n"))
		if len(fields) < 3 {
			continue
		}
		size, err := strconv.ParseInt(fields[len(fields)-1], 10, 64)
		if err != nil {
			continue
		}
		obj := catObject{Sha: fields[0], Type: fields[len(fields)-2], Size: size}
		if readData {
			obj.Data = make([]byte, size)
			if _, err := io.ReadFull(reader, obj.Data); err != nil {
				readErr = err
				break
			}
			if _, err := reader.Discard(1); err != nil && !errors.Is(err, io.EOF) {
				readErr = err
				break
			}
		}
		result[spec] = obj
	}

	io.Copy(io.Discard, stdout)
	waitErr := cmd.Wait()
	if readErr != nil {
		return result, fatalf("fatal: cannot read git cat-file output: %v", readErr)
	}
	if waitErr != nil {
		msg := strings.TrimRight(stderr.String(), "\n")
		if msg == "" {
			msg = fmt.Sprintf("fatal: git %s: %v", strings.Join(args, " "), waitErr)
		}
		return result, &FatalError{Message: msg, ExitCode: 128}
	}
	return result, nil
}

func (r *Repo) catFileBatch(specs []string) (map[string]catObject, error) {
	return r.batch([]string{"cat-file", "--batch"}, specs, true)
}

func (r *Repo) blobSizes(specs []string) (map[string]int64, error) {
	objs, err := r.batch([]string{"cat-file", "--batch-check"}, specs, false)
	if err != nil {
		return nil, err
	}
	sizes := make(map[string]int64, len(objs))
	for spec, obj := range objs {
		sizes[spec] = obj.Size
	}
	return sizes, nil
}

func (r *Repo) hashFile(path string) (string, error) {
	out, err := r.run("hash-object", "--no-filters", "--", path)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(out), "\n"), nil
}

func (r *Repo) SideContent(s *RevSpec, path string, side model.AnnotationSide) ([]string, string, error) {
	src := s.leftSide()
	if side == model.SideAdditions {
		src = s.rightSide()
	}
	switch src.kind {
	case sideNone:
		return []string{}, "", nil
	case sideWorktree:
		content, err := os.ReadFile(r.worktreePath(path))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil, "", fmt.Errorf("%s: %w", path, ErrNotFound)
			}
			return nil, "", err
		}
		sha, err := r.hashFile(path)
		if err != nil {
			return nil, "", err
		}
		return splitLines(content), sha, nil
	default:
		spec, ok := src.objectSpec(path)
		if !ok {
			return nil, "", fmt.Errorf("%s: %w", path, ErrNotFound)
		}
		objs, err := r.catFileBatch([]string{spec})
		if err != nil {
			return nil, "", err
		}
		obj, found := objs[spec]
		if !found {
			return nil, "", fmt.Errorf("%s: %w", path, ErrNotFound)
		}
		return splitLines(obj.Data), obj.Sha, nil
	}
}
