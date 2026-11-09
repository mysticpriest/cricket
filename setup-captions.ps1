# Cricket free English captions — one-time local setup (Windows PowerShell).
# Requires Python 3.11 or 3.12 and an internet connection for installation.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host "Setting up Cricket's free, local English captions..." -ForegroundColor Cyan

$venv = Join-Path $PSScriptRoot ".venv"
$python = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $python)) {
    $candidates = @(
        @{ Executable = 'py'; Prefix = @('-3.11') },
        @{ Executable = 'py'; Prefix = @('-3.12') },
        @{ Executable = 'python'; Prefix = @() }
    )
    foreach ($candidate in $candidates) {
        if (-not (Get-Command $candidate.Executable -ErrorAction SilentlyContinue)) { continue }
        $pythonArgs = @($candidate.Prefix) + @('-m', 'venv', $venv)
        try {
            & $candidate.Executable @pythonArgs 2>$null
            if ($LASTEXITCODE -eq 0 -and (Test-Path $python)) { break }
        } catch {
            # Try the next installed Python version.
        }
    }
    if (-not (Test-Path $python)) {
        throw "Install Python 3.11 or 3.12 (64-bit) from https://www.python.org/downloads/windows/ and run this installer again."
    }
}
& $python -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot "requirements-captions.txt")
if ($LASTEXITCODE -ne 0) { throw "Failed to install Faster-Whisper. Verify Python and your internet connection." }

Write-Host "Downloading the free English speech model for offline use..." -ForegroundColor Cyan
& $python -u (Join-Path $PSScriptRoot "server\local-caption-worker.py") --warmup
if ($LASTEXITCODE -ne 0) { throw "Could not download or initialize the English model." }

Write-Host ""
Write-Host "Cricket captions are ready. No API key or Azure account needed." -ForegroundColor Green
Write-Host 'Start Cricket: $env:HOST="127.0.0.1"; $env:PORT="3001"; npm.cmd start'
