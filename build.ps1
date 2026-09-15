<#
.SYNOPSIS
    Windows equivalent of the Makefile — build, test and lint dv without make.

.EXAMPLE
    .\build.ps1                 # web build + go build -> bin\dv.exe
    .\build.ps1 test
    .\build.ps1 build -Version 0.2.0 -Arch arm64
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'web', 'build', 'dev', 'test', 'test-go', 'test-web',
                 'typecheck', 'fmt', 'vet', 'clean')]
    [string]$Task = 'all',

    [string]$Version = '0.1.0',

    [ValidateSet('amd64', 'arm64')]
    [string]$Arch = 'amd64',

    [string]$Go = 'go',
    [string]$Bun = 'bun'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = $PSScriptRoot
$webDir = Join-Path $root 'web'
$binDir = Join-Path $root 'bin'
$exe = Join-Path $binDir 'dv.exe'

function Invoke-Step {
    param([string]$Name, [scriptblock]$Body)

    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Body
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Build-Web {
    Push-Location $webDir
    try {
        Invoke-Step 'bun install' { & $Bun install --frozen-lockfile }
        Invoke-Step 'vite build' { & $Bun run build }
    } finally {
        Pop-Location
    }
}

function Build-Binary {
    Build-Web
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null

    $env:CGO_ENABLED = '0'
    $env:GOOS = 'windows'
    $env:GOARCH = $Arch
    try {
        Invoke-Step "go build ($Arch)" {
            & $Go build -trimpath -ldflags "-s -w -X main.version=$Version" -o $exe $root
        }
    } finally {
        Remove-Item env:CGO_ENABLED, env:GOOS, env:GOARCH -ErrorAction SilentlyContinue
    }
    Write-Host "built $exe" -ForegroundColor Green
}

switch ($Task) {
    'all'   { Build-Binary }
    'web'   { Build-Web }
    'build' { Build-Binary }

    'dev' {
        $vite = Start-Process -FilePath $Bun -ArgumentList 'run', 'dev' `
            -WorkingDirectory $webDir -PassThru -NoNewWindow
        try {
            & $Go run $root --dev-proxy http://localhost:5173
        } finally {
            if (-not $vite.HasExited) { Stop-Process -Id $vite.Id -Force }
        }
    }

    'test' {
        Invoke-Step 'go test' { & $Go test ./... }
        Push-Location $webDir
        try { Invoke-Step 'vitest' { & $Bun run test } } finally { Pop-Location }
    }

    'test-go' { Invoke-Step 'go test' { & $Go test ./... } }

    'test-web' {
        Push-Location $webDir
        try { Invoke-Step 'vitest' { & $Bun run test } } finally { Pop-Location }
    }

    'typecheck' {
        Push-Location $webDir
        try { Invoke-Step 'tsc --noEmit' { & $Bun run typecheck } } finally { Pop-Location }
    }

    'fmt' { Invoke-Step 'go fmt' { & $Go fmt ./... } }
    'vet' { Invoke-Step 'go vet' { & $Go vet ./... } }

    'clean' {
        Remove-Item -Recurse -Force $binDir -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force (Join-Path $webDir 'node_modules') -ErrorAction SilentlyContinue
        Get-ChildItem (Join-Path $webDir 'dist') -Force -ErrorAction SilentlyContinue |
            Where-Object Name -ne '.gitkeep' |
            Remove-Item -Recurse -Force
    }
}
