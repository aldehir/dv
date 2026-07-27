package config

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func ConfigPath() string {
	if dir := os.Getenv("XDG_CONFIG_HOME"); dir != "" {
		return filepath.Join(dir, "dv", "config.toml")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".config", "dv", "config.toml")
}

func LoadFile(path string) (Config, error) {
	cfg := Default()
	if path == "" {
		return cfg, nil
	}

	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, err
	}
	defer f.Close()

	if err := applyTOML(&cfg, f); err != nil {
		return cfg, fmt.Errorf("%s: %w", path, err)
	}
	return cfg, nil
}

func applyTOML(cfg *Config, r io.Reader) error {
	scanner := bufio.NewScanner(r)
	line := 0

	for scanner.Scan() {
		line++
		text := strings.TrimSpace(scanner.Text())
		if text == "" || strings.HasPrefix(text, "#") || strings.HasPrefix(text, "[") {
			continue
		}

		rawKey, rawValue, ok := strings.Cut(text, "=")
		if !ok {
			return fmt.Errorf("line %d: expected key = value", line)
		}

		key := strings.TrimSpace(rawKey)
		value := unquote(stripComment(strings.TrimSpace(rawValue)))

		if err := applyKey(cfg, key, value); err != nil {
			return fmt.Errorf("line %d: %w", line, err)
		}
	}

	return scanner.Err()
}

func applyKey(cfg *Config, key, value string) error {
	switch key {
	case "host":
		cfg.Host = value
	case "port":
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 || n > 65535 {
			return fmt.Errorf("invalid port %q", value)
		}
		cfg.Port = n
	case "theme":
		if !validThemes[value] {
			return fmt.Errorf("invalid theme %q", value)
		}
		cfg.Theme = value
	case "view":
		if !validViews[value] {
			return fmt.Errorf("invalid view %q", value)
		}
		cfg.View = value
	case "wrap":
		b, err := parseBool(value)
		if err != nil {
			return err
		}
		cfg.Wrap = b
	case "untracked":
		b, err := parseBool(value)
		if err != nil {
			return err
		}
		cfg.Untracked = b
	case "no_open":
		b, err := parseBool(value)
		if err != nil {
			return err
		}
		cfg.NoOpen = b
	case "max_blob":
		n, err := parseSize(value)
		if err != nil {
			return err
		}
		cfg.MaxBlob = n
	case "comments":
		cfg.Comments = value
	case "idle_timeout":
		d, err := time.ParseDuration(value)
		if err != nil {
			return fmt.Errorf("invalid idle_timeout %q", value)
		}
		cfg.IdleTimeout = d
	default:
		return fmt.Errorf("unknown key %q", key)
	}
	return nil
}

func parseBool(v string) (bool, error) {
	switch v {
	case "true":
		return true, nil
	case "false":
		return false, nil
	}
	return false, fmt.Errorf("invalid boolean %q", v)
}

func stripComment(v string) string {
	if strings.HasPrefix(v, `"`) {
		if end := strings.Index(v[1:], `"`); end >= 0 {
			return v[:end+2]
		}
		return v
	}
	if before, _, ok := strings.Cut(v, "#"); ok {
		return strings.TrimSpace(before)
	}
	return v
}

func unquote(v string) string {
	if len(v) >= 2 && strings.HasPrefix(v, `"`) && strings.HasSuffix(v, `"`) {
		return v[1 : len(v)-1]
	}
	return v
}
