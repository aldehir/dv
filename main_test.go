package main

import (
	"testing"

	"github.com/alde/dv/internal/config"
)

func TestDefaultsCarryOnlyWhatWasAsked(t *testing.T) {
	base := config.Default()
	cfg, _, err := config.Parse(base, nil)
	if err != nil {
		t.Fatal(err)
	}
	d := defaults(cfg, base, nil)
	if d.Theme != "" || d.View != "" || d.Wrap != nil {
		t.Errorf("defaults = %+v, want nothing when nothing was asked for", d)
	}

	argv := []string{"--view=unified", "--wrap", "--theme", "latte", "--", "--view"}
	cfg, _, err = config.Parse(base, argv)
	if err != nil {
		t.Fatal(err)
	}
	d = defaults(cfg, base, argv)
	if d.Theme != "latte" || d.View != "unified" || d.Wrap == nil || !*d.Wrap {
		t.Errorf("defaults = %+v, want latte, unified and wrap from the flags", d)
	}

	file := base
	file.View = "unified"
	d = defaults(file, file, nil)
	if d.View != "unified" || d.Wrap != nil {
		t.Errorf("defaults = %+v, want the config file's view and no wrap", d)
	}
}

func TestFlagGivenStopsAtDoubleDash(t *testing.T) {
	if flagGiven([]string{"HEAD", "--", "--view"}, "--view") {
		t.Error("a pathspec after -- counted as --view")
	}
	if !flagGiven([]string{"--view", "split"}, "--view") {
		t.Error("--view as its own argument was missed")
	}
}
