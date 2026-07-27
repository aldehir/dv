package server

import (
	"path"
	"strings"
)

var langByExtension = map[string]string{
	"astro":        "astro",
	"bash":         "bash",
	"c":            "c",
	"cc":           "cpp",
	"cfg":          "ini",
	"clj":          "clojure",
	"cmake":        "cmake",
	"conf":         "ini",
	"cpp":          "cpp",
	"cs":           "csharp",
	"css":          "css",
	"cxx":          "cpp",
	"dart":         "dart",
	"diff":         "diff",
	"ex":           "elixir",
	"exs":          "elixir",
	"fish":         "fish",
	"go":           "go",
	"gql":          "graphql",
	"graphql":      "graphql",
	"h":            "c",
	"hbs":          "handlebars",
	"hpp":          "cpp",
	"hs":           "haskell",
	"htm":          "html",
	"html":         "html",
	"ini":          "ini",
	"java":         "java",
	"js":           "javascript",
	"json":         "json",
	"json5":        "json5",
	"jsonc":        "jsonc",
	"jsx":          "jsx",
	"kt":           "kotlin",
	"kts":          "kotlin",
	"less":         "less",
	"lua":          "lua",
	"m":            "objective-c",
	"md":           "markdown",
	"markdown":     "markdown",
	"mdx":          "mdx",
	"mjs":          "javascript",
	"cjs":          "javascript",
	"mts":          "typescript",
	"cts":          "typescript",
	"nix":          "nix",
	"patch":        "diff",
	"php":          "php",
	"pl":           "perl",
	"proto":        "proto",
	"ps1":          "powershell",
	"py":           "python",
	"r":            "r",
	"rb":           "ruby",
	"rs":           "rust",
	"scala":        "scala",
	"scss":         "scss",
	"sh":           "shellscript",
	"sql":          "sql",
	"svelte":       "svelte",
	"svg":          "xml",
	"swift":        "swift",
	"tex":          "latex",
	"tf":           "terraform",
	"tfvars":       "terraform",
	"toml":         "toml",
	"ts":           "typescript",
	"tsx":          "tsx",
	"vim":          "viml",
	"vue":          "vue",
	"xml":          "xml",
	"yaml":         "yaml",
	"yml":          "yaml",
	"zig":          "zig",
	"zsh":          "bash",
	"gitignore":    "ignore",
	"dockerfile":   "dockerfile",
	"gradle":       "groovy",
	"properties":   "ini",
	"sbt":          "scala",
	"erl":          "erlang",
	"ml":           "ocaml",
	"mli":          "ocaml",
	"rst":          "rst",
	"txt":          "plaintext",
	"env":          "dotenv",
	"editorconfig": "ini",
}

var langByName = map[string]string{
	"dockerfile":     "dockerfile",
	"makefile":       "makefile",
	"gnumakefile":    "makefile",
	"cmakelists.txt": "cmake",
	"justfile":       "make",
	"gemfile":        "ruby",
	"rakefile":       "ruby",
	"vagrantfile":    "ruby",
	"brewfile":       "ruby",
	"go.mod":         "ini",
	"go.sum":         "plaintext",
}

func langFor(filePath string) string {
	name := strings.ToLower(path.Base(filePath))
	if lang, ok := langByName[name]; ok {
		return lang
	}
	ext := strings.TrimPrefix(path.Ext(name), ".")
	if ext == "" {
		ext = strings.TrimPrefix(name, ".")
	}
	return langByExtension[ext]
}
