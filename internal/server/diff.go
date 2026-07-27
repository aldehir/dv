package server

import (
	"net/http"

	"github.com/alde/dv/internal/gitx"
	"github.com/alde/dv/internal/model"
)

func (s *Server) handleSession(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, model.Session{
		RepoRoot: s.opts.Repo.Root,
		Head:     s.head,
		Spec:     s.opts.Spec.Model(),
		Argv:     s.opts.Spec.Argv,
		Defaults: s.opts.Defaults,
		Comments: s.opts.Store != nil,
	})
}

func (s *Server) handleManifest(w http.ResponseWriter, r *http.Request) {
	m, err := s.Manifest()
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.lookupFile(w, r)
	if !ok {
		return
	}
	payload, err := s.opts.Repo.File(s.opts.Spec, entry, s.opts.Git)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) lookupFile(w http.ResponseWriter, r *http.Request) (model.FileEntry, bool) {
	id := r.PathValue("id")
	path, err := gitx.PathFromFileID(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "malformed file id", id)
		return model.FileEntry{}, false
	}
	m, err := s.cachedManifest()
	if err != nil {
		s.fail(w, r, err)
		return model.FileEntry{}, false
	}
	for _, e := range m.Files {
		if e.ID == id {
			return e, true
		}
	}
	writeError(w, http.StatusNotFound, "no such file in this diff", path)
	return model.FileEntry{}, false
}
