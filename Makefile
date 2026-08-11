GO      ?= go
BUN     ?= bun
VERSION ?= 0.1.0
WINARCH ?= amd64
LDFLAGS  = -s -w -X main.version=$(VERSION)

.PHONY: all web build build-windows dev test test-go test-web typecheck fmt vet clean

all: build

web:
	cd web && $(BUN) install --frozen-lockfile && $(BUN) run build

build: web
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags='$(LDFLAGS)' -o bin/dv .

build-windows: web
	CGO_ENABLED=0 GOOS=windows GOARCH=$(WINARCH) $(GO) build -trimpath \
		-ldflags='$(LDFLAGS)' -o bin/dv-windows-$(WINARCH).exe .

dev:
	cd web && $(BUN) run dev & $(GO) run . --dev-proxy http://localhost:5173

test: test-go test-web

test-go:
	$(GO) test ./...

test-web:
	cd web && $(BUN) run test

typecheck:
	cd web && $(BUN) run typecheck

fmt:
	$(GO) fmt ./...

vet:
	$(GO) vet ./...

clean:
	rm -rf bin web/dist/* web/node_modules
	touch web/dist/.gitkeep
