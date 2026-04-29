# run-dev.ps1 — Launch the two backend processes in separate windows.
#
# Usage (from any directory):
#   pwsh backend\run-dev.ps1
#   # or just: backend\run-dev.ps1
#
# Each process runs in its own console. Ctrl+C inside a window stops only
# that process — the other keeps running. Close the window to kill.
#
# Prerequisites: supabase started (`supabase start`), backend/.env populated.

$ErrorActionPreference = 'Stop'

# Resolve backend/ regardless of where the script is invoked from.
$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Pick PowerShell flavour: prefer pwsh (7+), fall back to powershell (5.1).
$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }

Write-Host "Launching API + Scraper in separate windows..." -ForegroundColor Cyan
Write-Host "  backend dir: $backendDir"
Write-Host "  shell:       $shell"
Write-Host "  API     -> http://localhost:8080  (Ctrl+C to stop)"
Write-Host "  Scraper -> http://localhost:8081/health  (Ctrl+C to stop)"
Write-Host ""

# Each Start-Process spawns a fresh PowerShell window that stays open
# (-NoExit) so you can read logs after the process exits.
Start-Process -FilePath $shell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$backendDir'; `$Host.UI.RawUI.WindowTitle = 'africgreen-api'; go run ./cmd/api"
)

Start-Process -FilePath $shell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$backendDir'; `$Host.UI.RawUI.WindowTitle = 'africgreen-scraper'; go run ./cmd/scraper"
)

Write-Host "Both windows launched. This shell is free." -ForegroundColor Green
