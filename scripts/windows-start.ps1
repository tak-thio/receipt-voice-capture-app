param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

function Find-Npm {
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCmd) {
    return $npmCmd.Source
  }

  $bundledNpm = Join-Path $env:TEMP "node-v24.11.1-win-x64\npm.cmd"
  if (Test-Path $bundledNpm) {
    return $bundledNpm
  }

  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm -and $npm.Source -notlike "*.ps1") {
    return $npm.Source
  }

  throw "npm was not found. Install Node.js LTS, then run this launcher again."
}

function Import-VsBuildTools {
  $vswhereCandidates = @(
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
    "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
  )
  $vswhere = $vswhereCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $vswhere) {
    Write-Warning "Visual Studio Build Tools was not found. Tauri may fail if Rust dependencies need linking."
    return
  }

  $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $installPath) {
    Write-Warning "Visual Studio C++ Build Tools workload was not found."
    return
  }

  $vcvars = Join-Path $installPath "VC\Auxiliary\Build\vcvars64.bat"
  if (-not (Test-Path $vcvars)) {
    Write-Warning "vcvars64.bat was not found at $vcvars."
    return
  }

  cmd /c "call `"$vcvars`" && set" | ForEach-Object {
    if ($_ -match "^(.*?)=(.*)$") {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
  }
}

if (Test-Path "$env:USERPROFILE\.cargo\bin") {
  $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
}

Import-VsBuildTools
$npm = Find-Npm
$npmDir = Split-Path -Parent $npm
$env:Path = "$npmDir;$env:Path"

if (-not $SkipInstall -and -not (Test-Path (Join-Path $repoRoot "node_modules"))) {
  Write-Host "node_modules was not found. Running npm install..."
  & $npm install
}

Write-Host ""
Write-Host "Starting receipt voice capture app..."
Write-Host "API keys should be entered in the app Settings screen, not in this terminal."
Write-Host ""

& $npm run app:test
