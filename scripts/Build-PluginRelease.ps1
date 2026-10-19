# Requires Node.js, npm and Git on the development/build computer.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^plugins-[A-Za-z0-9][A-Za-z0-9-]{0,79}$')]
    [string]$Tag
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$output = Join-Path $repoRoot ".plugin-releases/$Tag"
if (Test-Path -LiteralPath $output) { throw "Output already exists: $output" }
Push-Location $repoRoot
try {
    $commit = & git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read the source commit.' }
    foreach ($project in @('HomeWidgets', 'MyCalendar')) {
        & npm --prefix (Join-Path $repoRoot $project) run build
        if ($LASTEXITCODE -ne 0) { throw "Build failed: $project" }
    }
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $stage = Join-Path $output 'content'
    New-Item -ItemType Directory -Path $stage | Out-Null
    $plugins = @()
    foreach ($spec in @(@('HomeWidgets', 'home-widgets'), @('MyCalendar', 'my-calendar'))) {
        $project = $spec[0]
        $id = $spec[1]
        $build = Join-Path $repoRoot "$project/build"
        $manifest = Get-Content -LiteralPath (Join-Path $build 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.id -cne $id) { throw "Unexpected plugin ID in $project" }
        $destination = Join-Path $stage $id
        New-Item -ItemType Directory -Path $destination | Out-Null
        $files = @()
        foreach ($name in @('main.js', 'manifest.json', 'styles.css')) {
            $source = Join-Path $build $name
            Copy-Item -LiteralPath $source -Destination (Join-Path $destination $name)
            $files += [ordered]@{ name = $name; sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() }
        }
        $plugins += [ordered]@{ id = $id; version = $manifest.version; files = $files }
    }
    $bundle = [ordered]@{
        schema = 1
        tag = $Tag
        commit = $commit.Trim()
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
        plugins = $plugins
    }
    $bundle | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stage 'bundle.json') -Encoding UTF8
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = Join-Path $output 'obsidian-plugins.zip'
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive)
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  obsidian-plugins.zip" | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS') -Encoding ASCII
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Update-Plugins.ps1') -Destination $output
    @(
        "Plugin bundle: $Tag"
        "Source commit: $($commit.Trim())"
        ''
        ($plugins | ForEach-Object { "- $($_.id): $($_.version)" })
        ''
        'Download Update-Plugins.ps1 on the other Windows computer and run:'
        '.\Update-Plugins.ps1 -VaultPath "D:\path\to\your-vault"'
        ''
        'Close Obsidian before updating; reopen it after the update.'
        'Only plugin code is updated. Existing data.json and vault notes are preserved.'
    ) | Set-Content -LiteralPath (Join-Path $output 'release-notes.md') -Encoding UTF8
    Write-Output "Release files prepared: $output"
} finally {
    Pop-Location
}
