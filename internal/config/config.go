package config

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultPort        = 8765
	DefaultHost        = "127.0.0.1"
	DefaultTheme       = "auto"
	DefaultView        = "split"
	DefaultMaxBlob     = 2 << 20
	DefaultIdleTimeout = 30 * time.Minute
)

type Config struct {
	Host        string
	Port        int
	NoOpen      bool
	Theme       string
	View        string
	Wrap        bool
	Untracked   bool
	MaxBlob     int64
	OpenFile    string
	Comments    string
	NoComments  bool
	DevProxy    string
	IdleTimeout time.Duration
	Help        bool
	Version     bool
}

func Default() Config {
	return Config{
		Host:        DefaultHost,
		Port:        DefaultPort,
		Theme:       DefaultTheme,
		View:        DefaultView,
		MaxBlob:     DefaultMaxBlob,
		IdleTimeout: DefaultIdleTimeout,
	}
}

var validThemes = map[string]bool{
	"auto": true, "latte": true, "frappe": true, "macchiato": true, "mocha": true,
}

var validViews = map[string]bool{"split": true, "unified": true}

type boolFlag struct {
	name string
	set  func(*Config)
}

type valueFlag struct {
	name string
	set  func(*Config, string) error
}

var boolFlags = []boolFlag{
	{"--no-open", func(c *Config) { c.NoOpen = true }},
	{"--wrap", func(c *Config) { c.Wrap = true }},
	{"--untracked", func(c *Config) { c.Untracked = true }},
	{"--no-comments", func(c *Config) { c.NoComments = true }},
	{"--help", func(c *Config) { c.Help = true }},
	{"-h", func(c *Config) { c.Help = true }},
	{"--version", func(c *Config) { c.Version = true }},
}

var valueFlags = []valueFlag{
	{"--host", func(c *Config, v string) error { c.Host = v; return nil }},
	{"--port", func(c *Config, v string) error {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 || n > 65535 {
			return fmt.Errorf("invalid --port %q", v)
		}
		c.Port = n
		return nil
	}},
	{"--theme", func(c *Config, v string) error {
		if !validThemes[v] {
			return fmt.Errorf("invalid --theme %q: want auto|latte|frappe|macchiato|mocha", v)
		}
		c.Theme = v
		return nil
	}},
	{"--view", func(c *Config, v string) error {
		if !validViews[v] {
			return fmt.Errorf("invalid --view %q: want split|unified", v)
		}
		c.View = v
		return nil
	}},
	{"--max-blob", func(c *Config, v string) error {
		n, err := parseSize(v)
		if err != nil {
			return err
		}
		c.MaxBlob = n
		return nil
	}},
	{"--open-file", func(c *Config, v string) error { c.OpenFile = v; return nil }},
	{"--comments", func(c *Config, v string) error { c.Comments = v; return nil }},
	{"--dev-proxy", func(c *Config, v string) error { c.DevProxy = v; return nil }},
	{"--idle-timeout", func(c *Config, v string) error {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("invalid --idle-timeout %q", v)
		}
		c.IdleTimeout = d
		return nil
	}},
}

func Parse(base Config, argv []string) (Config, []string, error) {
	cfg := base
	var rest []string

	for i := 0; i < len(argv); i++ {
		arg := argv[i]

		if arg == "--" {
			rest = append(rest, argv[i:]...)
			break
		}

		name, inline, hasInline := splitInline(arg)

		if bf := findBool(name); bf != nil && !hasInline {
			bf.set(&cfg)
			continue
		}

		if vf := findValue(name); vf != nil {
			value := inline
			if !hasInline {
				if i+1 >= len(argv) {
					return cfg, nil, fmt.Errorf("flag %s requires a value", name)
				}
				i++
				value = argv[i]
			}
			if err := vf.set(&cfg, value); err != nil {
				return cfg, nil, err
			}
			continue
		}

		rest = append(rest, arg)
	}

	return cfg, rest, nil
}

func splitInline(arg string) (name, value string, ok bool) {
	if !strings.HasPrefix(arg, "--") {
		return arg, "", false
	}
	if eq := strings.IndexByte(arg, '='); eq > 0 {
		return arg[:eq], arg[eq+1:], true
	}
	return arg, "", false
}

func findBool(name string) *boolFlag {
	for i := range boolFlags {
		if boolFlags[i].name == name {
			return &boolFlags[i]
		}
	}
	return nil
}

func findValue(name string) *valueFlag {
	for i := range valueFlags {
		if valueFlags[i].name == name {
			return &valueFlags[i]
		}
	}
	return nil
}

func parseSize(v string) (int64, error) {
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return 0, fmt.Errorf("invalid size %q", v)
	}

	suffixes := []struct {
		text string
		mult int64
	}{
		{"KIB", 1 << 10}, {"MIB", 1 << 20}, {"GIB", 1 << 30},
		{"KB", 1 << 10}, {"MB", 1 << 20}, {"GB", 1 << 30},
		{"K", 1 << 10}, {"M", 1 << 20}, {"G", 1 << 30}, {"B", 1},
	}

	mult := int64(1)
	upper := strings.ToUpper(trimmed)
	for _, s := range suffixes {
		if len(upper) > len(s.text) && strings.HasSuffix(upper, s.text) {
			mult = s.mult
			trimmed = trimmed[:len(trimmed)-len(s.text)]
			break
		}
	}

	n, err := strconv.ParseInt(strings.TrimSpace(trimmed), 10, 64)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("invalid size %q", v)
	}
	return n * mult, nil
}
