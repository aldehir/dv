package openbrowser

import (
	"runtime"
	"strings"
	"testing"
)

func TestLauncherIncludesURL(t *testing.T) {
	const url = "http://127.0.0.1:8765/#abc"

	name, args := launcher(url)
	if name == "" {
		if runtime.GOOS == "linux" {
			t.Skip("no known opener on PATH")
		}
		t.Fatalf("no launcher for %s", runtime.GOOS)
	}

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, url) {
		t.Errorf("args %q do not contain url %q", joined, url)
	}
}

func TestLauncherPlatformShape(t *testing.T) {
	name, args := launcher("http://example.test")

	switch runtime.GOOS {
	case "darwin":
		if name != "open" || len(args) != 1 {
			t.Errorf("darwin: got %q %v", name, args)
		}
	case "windows":
		if name != "rundll32" || len(args) != 2 {
			t.Errorf("windows: got %q %v", name, args)
		}
	default:
		if name != "" && len(args) == 0 {
			t.Errorf("unix: launcher %q returned no args", name)
		}
	}
}
