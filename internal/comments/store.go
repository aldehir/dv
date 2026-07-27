package comments

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/alde/dv/internal/model"
)

const (
	DefaultFileName = "comments.json"
	BackupSuffix    = ".bak"

	commentIDPrefix = "cmt_"
	replyIDPrefix   = "rpl_"

	etagLength = 32
	filePerm   = 0o644
	dirPerm    = 0o755
)

var (
	ErrConflict = errors.New("comments: etag does not match the document on disk")
	ErrNotFound = errors.New("comments: no such comment")
	ErrInvalid  = errors.New("comments: invalid request")
)

type Config struct {
	Path         string
	Repo         model.RepoRef
	Spec         model.Spec
	Generator    string
	Author       model.Author
	Logger       *slog.Logger
	Now          func() time.Time
	OnFirstWrite func(path string)
}

type Report struct {
	QuarantinePath string
	Issues         []string
}

func (r Report) Quarantined() bool { return r.QuarantinePath != "" }

type Store struct {
	path         string
	repo         model.RepoRef
	spec         model.Spec
	generator    string
	author       model.Author
	log          *slog.Logger
	now          func() time.Time
	onFirstWrite func(string)

	mu       sync.Mutex
	report   Report
	lastSeen string
}

func New(cfg Config) (*Store, error) {
	path := cfg.Path
	if path == "" {
		if cfg.Repo.Root == "" {
			return nil, fmt.Errorf("%w: neither Path nor Repo.Root is set", ErrInvalid)
		}
		path = filepath.Join(cfg.Repo.Root, DefaultFileName)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if fi, err := os.Stat(abs); err == nil && fi.IsDir() {
		return nil, fmt.Errorf("%w: %s is a directory", ErrInvalid, abs)
	}
	generator := cfg.Generator
	if generator == "" {
		generator = "dv"
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	nowFn := cfg.Now
	if nowFn == nil {
		nowFn = time.Now
	}
	return &Store{
		path:         abs,
		repo:         cfg.Repo,
		spec:         cfg.Spec,
		generator:    generator,
		author:       cfg.Author,
		log:          logger,
		now:          nowFn,
		onFirstWrite: cfg.OnFirstWrite,
	}, nil
}

func (s *Store) Path() string { return s.path }

func (s *Store) Exists() bool {
	fi, err := os.Stat(s.path)
	return err == nil && !fi.IsDir()
}

func (s *Store) Report() Report {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Report{
		QuarantinePath: s.report.QuarantinePath,
		Issues:         slices.Clone(s.report.Issues),
	}
}

func (s *Store) Load() (*model.CommentsDoc, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *Store) loadLocked() (*model.CommentsDoc, string, error) {
	raw, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		doc := s.newDoc()
		etag, err := docETag(doc)
		if err != nil {
			return nil, "", err
		}
		s.report = Report{}
		s.lastSeen = etag
		return doc, etag, nil
	case err != nil:
		return nil, "", err
	}

	etag := etagOf(raw)
	doc := &model.CommentsDoc{}
	if err := json.Unmarshal(raw, doc); err != nil {
		return s.quarantineLocked(fmt.Errorf("%w: %s", ErrSchema, err))
	}
	if err := validate(doc); err != nil {
		return s.quarantineLocked(err)
	}

	issues := repair(doc, s.nowString(), s.author)
	sortComments(doc)
	s.report = Report{Issues: issues}
	if len(issues) > 0 {
		s.log.Warn("repaired comments file", "path", s.path, "issues", len(issues))
	}
	s.lastSeen = etag
	return doc, etag, nil
}

func (s *Store) quarantineLocked(cause error) (*model.CommentsDoc, string, error) {
	bak := s.path + BackupSuffix
	report := Report{Issues: []string{cause.Error()}}
	if err := os.Rename(s.path, bak); err != nil {
		report.Issues = append(report.Issues, fmt.Sprintf("could not move the file aside: %s", err))
		s.log.Error("comments file is unreadable and could not be quarantined", "path", s.path, "error", cause, "rename", err)
	} else {
		report.QuarantinePath = bak
		s.log.Warn("comments file is unreadable, moved aside", "path", s.path, "backup", bak, "error", cause)
	}
	s.report = report

	doc := s.newDoc()
	etag, err := docETag(doc)
	if err != nil {
		return nil, "", err
	}
	s.lastSeen = etag
	return doc, etag, nil
}

func (s *Store) newDoc() *model.CommentsDoc {
	return &model.CommentsDoc{
		Version:   model.SchemaVersion,
		Generator: s.generator,
		Repo:      s.repo,
		Spec:      s.spec,
		Comments:  []model.Comment{},
	}
}

func (s *Store) nowString() string {
	return s.now().UTC().Format(time.RFC3339)
}

func (s *Store) mutate(ifMatch string, fn func(doc *model.CommentsDoc) error) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	doc, etag, err := s.loadLocked()
	if err != nil {
		return "", err
	}
	if !etagMatches(ifMatch, etag) {
		return "", fmt.Errorf("%w: have %q, want %q", ErrConflict, ifMatch, etag)
	}
	if err := fn(doc); err != nil {
		return "", err
	}
	return s.saveLocked(doc)
}

func (s *Store) saveLocked(doc *model.CommentsDoc) (string, error) {
	if doc.Version == 0 {
		doc.Version = model.SchemaVersion
	}
	if doc.Generator == "" {
		doc.Generator = s.generator
	}
	if doc.Repo.Root == "" {
		doc.Repo = s.repo
	}
	if doc.Spec.Kind == "" {
		doc.Spec = s.spec
	}
	if doc.Comments == nil {
		doc.Comments = []model.Comment{}
	}
	doc.UpdatedAt = s.nowString()
	sortComments(doc)

	raw, err := serialize(doc)
	if err != nil {
		return "", err
	}
	first := !s.Exists()
	if err := writeAtomic(s.path, raw); err != nil {
		return "", err
	}
	etag := etagOf(raw)
	s.lastSeen = etag
	if first && s.onFirstWrite != nil {
		s.onFirstWrite(s.path)
	}
	return etag, nil
}

func (s *Store) Add(anchor model.Anchor, body string) (*model.Comment, string, error) {
	return s.AddAs(anchor, body, model.Author{}, "")
}

func (s *Store) AddAs(anchor model.Anchor, body string, author model.Author, ifMatch string) (*model.Comment, string, error) {
	body = strings.TrimRight(body, " \t\n")
	if strings.TrimSpace(body) == "" {
		return nil, "", fmt.Errorf("%w: comment body is empty", ErrInvalid)
	}
	if anchor.EndLine < anchor.StartLine {
		anchor.EndLine = anchor.StartLine
	}
	if err := validateAnchor(anchor); err != nil {
		return nil, "", fmt.Errorf("%w: %s", ErrInvalid, err)
	}
	if anchor.ContextBefore == nil {
		anchor.ContextBefore = []string{}
	}
	if anchor.ContextAfter == nil {
		anchor.ContextAfter = []string{}
	}

	now := s.nowString()
	created := model.Comment{
		ID:        newID(commentIDPrefix),
		Author:    firstAuthor(author, s.author),
		CreatedAt: now,
		UpdatedAt: now,
		Body:      body,
		Anchor:    anchor,
		ResolvedAnchor: &model.ResolvedAnchor{
			Stale: false,
			Rule:  RuleExact,
		},
		Replies: []model.Reply{},
	}

	etag, err := s.mutate(ifMatch, func(doc *model.CommentsDoc) error {
		doc.Comments = append(doc.Comments, created)
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	out := cloneComment(created)
	return &out, etag, nil
}

func (s *Store) Update(id string, body *string, ifMatch string) (*model.Comment, string, error) {
	var out model.Comment
	etag, err := s.mutate(ifMatch, func(doc *model.CommentsDoc) error {
		c := findComment(doc, id)
		if c == nil {
			return fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		if body != nil {
			if strings.TrimSpace(*body) == "" {
				return fmt.Errorf("%w: comment body is empty", ErrInvalid)
			}
			c.Body = strings.TrimRight(*body, " \t\n")
			c.UpdatedAt = s.nowString()
		}
		out = cloneComment(*c)
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	return &out, etag, nil
}

func (s *Store) Delete(id, ifMatch string) (string, error) {
	return s.mutate(ifMatch, func(doc *model.CommentsDoc) error {
		i := slices.IndexFunc(doc.Comments, func(c model.Comment) bool { return c.ID == id })
		if i < 0 {
			return fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		doc.Comments = slices.Delete(doc.Comments, i, i+1)
		return nil
	})
}

func (s *Store) AddReply(id, body string, author model.Author, ifMatch string) (*model.Reply, string, error) {
	if strings.TrimSpace(body) == "" {
		return nil, "", fmt.Errorf("%w: reply body is empty", ErrInvalid)
	}
	var out model.Reply
	etag, err := s.mutate(ifMatch, func(doc *model.CommentsDoc) error {
		c := findComment(doc, id)
		if c == nil {
			return fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		now := s.nowString()
		reply := model.Reply{
			ID:        newID(replyIDPrefix),
			Author:    firstAuthor(author, s.author),
			CreatedAt: now,
			Body:      strings.TrimRight(body, " \t\n"),
		}
		c.Replies = append(c.Replies, reply)
		c.UpdatedAt = now
		out = reply
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	return &out, etag, nil
}

func (s *Store) Save(doc *model.CommentsDoc, ifMatch string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, etag, err := s.loadLocked()
	if err != nil {
		return "", err
	}
	if !etagMatches(ifMatch, etag) {
		return "", fmt.Errorf("%w: have %q, want %q", ErrConflict, ifMatch, etag)
	}
	if err := validate(doc); err != nil {
		return "", fmt.Errorf("%w: %s", ErrInvalid, err)
	}
	return s.saveLocked(doc)
}

func findComment(doc *model.CommentsDoc, id string) *model.Comment {
	for i := range doc.Comments {
		if doc.Comments[i].ID == id {
			return &doc.Comments[i]
		}
	}
	return nil
}

func cloneComment(c model.Comment) model.Comment {
	c.Replies = slices.Clone(c.Replies)
	c.Anchor.ContextBefore = slices.Clone(c.Anchor.ContextBefore)
	c.Anchor.ContextAfter = slices.Clone(c.Anchor.ContextAfter)
	if c.ResolvedAnchor != nil {
		ra := *c.ResolvedAnchor
		if ra.MovedFrom != nil {
			mf := *ra.MovedFrom
			ra.MovedFrom = &mf
		}
		c.ResolvedAnchor = &ra
	}
	return c
}

func firstAuthor(candidates ...model.Author) model.Author {
	for _, a := range candidates {
		if strings.TrimSpace(a.Name) != "" {
			return a
		}
	}
	return model.Author{Name: "unknown"}
}

func serialize(doc *model.CommentsDoc) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(doc); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func etagOf(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])[:etagLength]
}

func docETag(doc *model.CommentsDoc) (string, error) {
	raw, err := serialize(doc)
	if err != nil {
		return "", err
	}
	return etagOf(raw), nil
}

func etagMatches(ifMatch, etag string) bool {
	if strings.TrimSpace(ifMatch) == "" {
		return true
	}
	for _, token := range strings.Split(ifMatch, ",") {
		token = strings.TrimSpace(token)
		token = strings.TrimPrefix(token, "W/")
		token = strings.Trim(token, `"`)
		if token == "*" || token == etag {
			return true
		}
	}
	return false
}

func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, dirPerm); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer func() {
		if name != "" {
			os.Remove(name)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(filePerm); err != nil && !errors.Is(err, errors.ErrUnsupported) {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	name = ""
	syncDir(dir)
	return nil
}

func syncDir(dir string) {
	d, err := os.Open(dir)
	if err != nil {
		return
	}
	defer d.Close()
	_ = d.Sync()
}

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

var idState struct {
	mu   sync.Mutex
	ms   uint64
	tail [10]byte
}

func newID(prefix string) string {
	idState.mu.Lock()
	ms := uint64(time.Now().UTC().UnixMilli())
	if ms <= idState.ms && incrementTail(&idState.tail) {
		ms = idState.ms
	} else {
		idState.ms = ms
		if _, err := rand.Read(idState.tail[:]); err != nil {
			panic("comments: crypto/rand failed: " + err.Error())
		}
	}
	var raw [16]byte
	for i := range 6 {
		raw[i] = byte(ms >> (8 * (5 - uint(i))))
	}
	copy(raw[6:], idState.tail[:])
	idState.mu.Unlock()
	return prefix + encodeCrockford(raw[:])
}

func incrementTail(tail *[10]byte) bool {
	for i := len(tail) - 1; i >= 0; i-- {
		tail[i]++
		if tail[i] != 0 {
			return true
		}
	}
	return false
}

func encodeCrockford(src []byte) string {
	total := len(src) * 8
	chars := (total + 4) / 5
	pad := chars*5 - total
	out := make([]byte, chars)
	for i := range out {
		var v uint
		for j := range 5 {
			v = v<<1 | bitAt(src, i*5+j-pad)
		}
		out[i] = crockford[v]
	}
	return string(out)
}

func bitAt(src []byte, i int) uint {
	if i < 0 || i >= len(src)*8 {
		return 0
	}
	return uint(src[i/8]>>(7-uint(i%8))) & 1
}
