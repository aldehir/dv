package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/alde/dv/internal/comments"
	"github.com/alde/dv/internal/gitx"
	"github.com/alde/dv/internal/model"
)

const maxRequestBody = 1 << 20

func writeJSON(w http.ResponseWriter, status int, v any) {
	raw, err := json.Marshal(v)
	if err != nil {
		http.Error(w, `{"error":"cannot encode the response"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	w.Write(raw)
}

func writeError(w http.ResponseWriter, status int, message, detail string) {
	writeJSON(w, status, model.Error{Error: message, Detail: detail})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, into any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRequestBody))
	if err := dec.Decode(into); err != nil {
		writeError(w, http.StatusBadRequest, "cannot read the request body", err.Error())
		return false
	}
	return true
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	status, message := classify(err)
	if status >= http.StatusInternalServerError {
		s.log.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
	} else {
		s.log.Debug("request rejected", "method", r.Method, "path", r.URL.Path, "status", status, "error", err)
	}
	writeError(w, status, message, err.Error())
}

func classify(err error) (int, string) {
	switch {
	case errors.Is(err, comments.ErrConflict):
		return http.StatusConflict, "the comments file changed underneath this request"
	case errors.Is(err, comments.ErrNotFound):
		return http.StatusNotFound, "no such comment"
	case errors.Is(err, comments.ErrInvalid):
		return http.StatusBadRequest, "invalid request"
	case errors.Is(err, gitx.ErrNotFound):
		return http.StatusNotFound, "not present on that side of the diff"
	}
	var fatal *gitx.FatalError
	if errors.As(err, &fatal) {
		return http.StatusInternalServerError, fatal.Message
	}
	return http.StatusInternalServerError, "internal error"
}
