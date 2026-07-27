package openbrowser

import (
	"errors"
	"os/exec"
	"runtime"
)

var ErrUnsupported = errors.New("openbrowser: no launcher for this platform")

func Open(url string) error {
	name, args := launcher(url)
	if name == "" {
		return ErrUnsupported
	}
	cmd := exec.Command(name, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

func launcher(url string) (string, []string) {
	switch runtime.GOOS {
	case "darwin":
		return "open", []string{url}
	case "windows":
		return "rundll32", []string{"url.dll,FileProtocolHandler", url}
	default:
		for _, name := range []string{"xdg-open", "gio", "wslview", "sensible-browser"} {
			path, err := exec.LookPath(name)
			if err != nil {
				continue
			}
			if name == "gio" {
				return path, []string{"open", url}
			}
			return path, []string{url}
		}
		return "", nil
	}
}
