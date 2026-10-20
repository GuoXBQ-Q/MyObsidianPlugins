# Requires Node.js, npm and Git on the development/build computer.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^plugins-(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
    [string]$Tag,
    [switch]$CheckPreviousRelease
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
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stage = Join-Path $output 'content'
    New-Item -ItemType Directory -Path $stage | Out-Null
    $plugins = @()
    foreach ($spec in @(@('HomeWidgets', 'home-widgets'), @('MyCalendar', 'my-calendar'))) {
        $project = $spec[0]
        $id = $spec[1]
        $build = Join-Path $repoRoot "$project/build"
        $manifest = Get-Content -LiteralPath (Join-Path $build 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.id -cne $id) { throw "Unexpected plugin ID in $project" }
        if ($manifest.version -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw "Invalid plugin version in $project" }
        if ($manifest.minAppVersion -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw "Invalid minimum app version in $project" }
        $package = Get-Content -LiteralPath (Join-Path $repoRoot "$project/package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($package.version -cne $manifest.version) { throw "package.json and manifest.json versions differ in $project" }
        $destination = Join-Path $stage $id
        New-Item -ItemType Directory -Path $destination | Out-Null
        foreach ($name in @('main.js', 'manifest.json', 'styles.css')) {
            $source = Join-Path $build $name
            Copy-Item -LiteralPath $source -Destination (Join-Path $destination $name)
        }
        $archive = Join-Path $output "$id.zip"
        [System.IO.Compression.ZipFile]::CreateFromDirectory($destination, $archive)
        $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
        try {
            if ($zip.Entries.Count -ne 3) { throw "Unexpected archive contents: $id" }
            foreach ($name in @('main.js', 'manifest.json', 'styles.css')) {
                $entry = $zip.GetEntry($name)
                if (-not $entry) { throw "Missing release file: $id/$name" }
                $stream = $entry.Open()
                $sha256 = [System.Security.Cryptography.SHA256]::Create()
                try { $hash = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '') }
                finally { $stream.Dispose(); $sha256.Dispose() }
                if ($hash -ine (Get-FileHash -LiteralPath (Join-Path $build $name) -Algorithm SHA256).Hash) { throw "Release checksum mismatch: $id/$name" }
            }
        } finally { $zip.Dispose() }
        $plugins += [ordered]@{ id = $id; version = $manifest.version; minAppVersion = $manifest.minAppVersion; asset = "$id.zip" }
    }
    @(
        "Plugin builds: $Tag"
        "Source commit: $($commit.Trim())"
        ''
        ($plugins | ForEach-Object { "- $($_.id): $($_.version)" })
        ''
        'Each ZIP contains main.js, manifest.json and styles.css at its root.'
        ''
        '<!-- obsidian-plugin-updates:v1 -->'
        '```json'
        ([ordered]@{ formatVersion = 1; plugins = @($plugins) } | ConvertTo-Json -Depth 5)
        '```'
        '<!-- /obsidian-plugin-updates -->'
    ) | Set-Content -LiteralPath (Join-Path $output 'release-notes.md') -Encoding UTF8
    if ($CheckPreviousRelease) {
        & node (Join-Path $PSScriptRoot 'check-plugin-release.cjs') $output
        if ($LASTEXITCODE -ne 0) { throw 'Previous release version check failed' }
    }
    Write-Output "Release files prepared: $output"
} finally {
    Pop-Location
}
