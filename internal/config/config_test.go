package config

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestParseSplitsDvFlagsFromGitArgs(t *testing.T) {
	tests := []struct {
		name     string
		argv     []string
		wantRest []string
		check    func(*testing.T, Config)
	}{
		{
			name:     "no args",
			argv:     nil,
			wantRest: nil,
			check: func(t *testing.T, c Config) {
				if c.Port != DefaultPort || c.Theme != DefaultTheme {
					t.Errorf("defaults not preserved: %+v", c)
				}
			},
		},
		{
			name:     "dv flags stripped",
			argv:     []string{"--port", "9000", "--no-open", "HEAD~3"},
			wantRest: []string{"HEAD~3"},
			check: func(t *testing.T, c Config) {
				if c.Port != 9000 || !c.NoOpen {
					t.Errorf("got %+v", c)
				}
			},
		},
		{
			name:     "inline value form",
			argv:     []string{"--theme=mocha", "--view=unified"},
			wantRest: nil,
			check: func(t *testing.T, c Config) {
				if c.Theme != "mocha" || c.View != "unified" {
					t.Errorf("got theme=%q view=%q", c.Theme, c.View)
				}
			},
		},
		{
			name:     "git flags pass through",
			argv:     []string{"-M", "--ignore-all-space", "-U5", "main", "feature"},
			wantRest: []string{"-M", "--ignore-all-space", "-U5", "main", "feature"},
			check:    func(t *testing.T, c Config) {},
		},
		{
			name:     "everything after double dash is preserved",
			argv:     []string{"--wrap", "--", "--port", "src/"},
			wantRest: []string{"--", "--port", "src/"},
			check: func(t *testing.T, c Config) {
				if !c.Wrap {
					t.Error("--wrap not set")
				}
			},
		},
		{
			name:     "mixed dv and git flags",
			argv:     []string{"--untracked", "--cached", "--max-blob", "4MiB"},
			wantRest: []string{"--cached"},
			check: func(t *testing.T, c Config) {
				if !c.Untracked || c.MaxBlob != 4<<20 {
					t.Errorf("got %+v", c)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, rest, err := Parse(Default(), tt.argv)
			if err != nil {
				t.Fatalf("Parse: %v", err)
			}
			if !reflect.DeepEqual(rest, tt.wantRest) {
				t.Errorf("rest = %v, want %v", rest, tt.wantRest)
			}
			tt.check(t, cfg)
		})
	}
}

func TestParseErrors(t *testing.T) {
	for _, argv := range [][]string{
		{"--port", "notanumber"},
		{"--port", "99999"},
		{"--theme", "dracula"},
		{"--view", "sideways"},
		{"--max-blob", "-1"},
		{"--idle-timeout", "soon"},
		{"--port"},
	} {
		if _, _, err := Parse(Default(), argv); err == nil {
			t.Errorf("Parse(%v) = nil error, want failure", argv)
		}
	}
}

func TestParseSize(t *testing.T) {
	tests := map[string]int64{
		"1024":  1024,
		"2MiB":  2 << 20,
		"2M":    2 << 20,
		"512K":  512 << 10,
		"1GiB":  1 << 30,
		"500B":  500,
		"3mib":  3 << 20,
		"0":     0,
		" 8K  ": 8 << 10,
	}

	for input, want := range tests {
		got, err := parseSize(input)
		if err != nil {
			t.Errorf("parseSize(%q): %v", input, err)
			continue
		}
		if got != want {
			t.Errorf("parseSize(%q) = %d, want %d", input, got, want)
		}
	}

	for _, bad := range []string{"", "abc", "-5", "MiB", "1XB"} {
		if _, err := parseSize(bad); err == nil {
			t.Errorf("parseSize(%q) = nil error, want failure", bad)
		}
	}
}

func TestApplyTOML(t *testing.T) {
	src := `
# dv config
theme = "macchiato"
view = "unified"
port = 9100
wrap = true
max_blob = "8MiB"
idle_timeout = "15m"
host = "127.0.0.1"   # trailing comment
`

	cfg := Default()
	if err := applyTOML(&cfg, strings.NewReader(src)); err != nil {
		t.Fatalf("applyTOML: %v", err)
	}

	if cfg.Theme != "macchiato" {
		t.Errorf("theme = %q", cfg.Theme)
	}
	if cfg.View != "unified" {
		t.Errorf("view = %q", cfg.View)
	}
	if cfg.Port != 9100 {
		t.Errorf("port = %d", cfg.Port)
	}
	if !cfg.Wrap {
		t.Error("wrap not set")
	}
	if cfg.MaxBlob != 8<<20 {
		t.Errorf("max_blob = %d", cfg.MaxBlob)
	}
	if cfg.IdleTimeout != 15*time.Minute {
		t.Errorf("idle_timeout = %v", cfg.IdleTimeout)
	}
	if cfg.Host != "127.0.0.1" {
		t.Errorf("host = %q", cfg.Host)
	}
}

func TestApplyTOMLRejectsBadInput(t *testing.T) {
	for _, src := range []string{
		`theme = "dracula"`,
		`nonsense = 1`,
		`port = "abc"`,
		`wrap = yes`,
		`novalue`,
	} {
		cfg := Default()
		if err := applyTOML(&cfg, strings.NewReader(src)); err == nil {
			t.Errorf("applyTOML(%q) = nil error, want failure", src)
		}
	}
}

func TestFlagsOverrideFileConfig(t *testing.T) {
	base := Default()
	if err := applyTOML(&base, strings.NewReader(`theme = "latte"`+"\n"+`port = 1111`)); err != nil {
		t.Fatalf("applyTOML: %v", err)
	}

	cfg, _, err := Parse(base, []string{"--theme", "mocha"})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	if cfg.Theme != "mocha" {
		t.Errorf("flag did not override file: theme = %q", cfg.Theme)
	}
	if cfg.Port != 1111 {
		t.Errorf("file value lost: port = %d", cfg.Port)
	}
}
