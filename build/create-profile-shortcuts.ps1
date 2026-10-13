# Desktop shortcuts for running several copies of RGenerator at once.
#
# Each copy needs its own data profile — one database, one signed-in ChatGPT
# session, one set of settings per running instance. A profile is chosen with
# --profile=<name>, which is awkward to type, so this writes one shortcut per
# name and lets Windows pass the flag.
#
#   .\build\create-profile-shortcuts.ps1                       # P1, P2, P3
#   .\build\create-profile-shortcuts.ps1 -Names Work,Side
#   .\build\create-profile-shortcuts.ps1 -Exe "E:\...\RGenerator.exe"

[CmdletBinding()]
param(
  [string[]] $Names = @("P1", "P2", "P3"),
  [string] $Exe,
  [string] $Destination = [Environment]::GetFolderPath("Desktop")
)

$ErrorActionPreference = "Stop"

# Default to the installed app, then the unpacked build in this repo.
if (-not $Exe) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\rgenerator\RGenerator.exe"),
    (Join-Path $PSScriptRoot "..\release\win-unpacked\RGenerator.exe")
  )
  $Exe = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) {
  throw "Could not find RGenerator.exe. Pass one with -Exe."
}
$Exe = (Resolve-Path -LiteralPath $Exe).Path

# The portable build extracts itself to a new temp folder on every launch and
# takes its own "Portable" profile, so a --profile flag can't reach it.
if ($Exe -match "RGenerator \d") {
  Write-Warning "That looks like the portable exe, which always runs the 'Portable' profile. Use the installed or unpacked exe for named profiles."
}

$shell = New-Object -ComObject WScript.Shell
foreach ($name in $Names) {
  $clean = ($name -replace '[^A-Za-z0-9 _-]', '').Trim()
  if (-not $clean) { continue }
  $linkPath = Join-Path $Destination "RGenerator $clean.lnk"
  $link = $shell.CreateShortcut($linkPath)
  $link.TargetPath = $Exe
  $link.Arguments = "--profile=$clean"
  $link.WorkingDirectory = Split-Path -Parent $Exe
  $link.IconLocation = $Exe
  $link.Description = "RGenerator running the '$clean' data profile"
  $link.Save()
  Write-Host "Created $linkPath"
}

Write-Host ""
Write-Host "Each profile stores its data in %APPDATA%\RGenerator Profiles\<name>."
Write-Host "Sign in to ChatGPT once per profile, and add an API key in each."
