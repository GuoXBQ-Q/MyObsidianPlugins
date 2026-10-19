# Standalone updater for Windows PowerShell 5.1 and PowerShell 7.
[CmdletBinding(DefaultParameterSetName = 'GitHub')]
param(
    [Parameter(Mandatory = $true)]
    [string]$VaultPath,
    [Parameter(ParameterSetName = 'GitHub')]
    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
    [string]$Repo = 'GuoXBQ-Q/MyObsidianPlugins',
    [Parameter(ParameterSetName = 'GitHub')]
    [ValidatePattern('^(latest|plugins-[A-Za-z0-9][A-Za-z0-9-]{0,79})$')]
    [string]$Tag = 'latest',
    [Parameter(Mandatory = $true, ParameterSetName = 'Local')]
    [string]$PackagePath,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
Add-Type -AssemblyName System.IO.Compression.FileSystem
$vault = (Resolve-Path -LiteralPath $VaultPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $vault '.obsidian') -PathType Container)) {
    throw 'VaultPath must point to an existing Obsidian vault containing .obsidian.'
}
function Assert-PlainPath([string]$Path) {
    $itemPath = [System.IO.Path]::GetFullPath($Path)
    while ($itemPath -and $itemPath.Length -ge $vault.Length) {
        if (Test-Path -LiteralPath $itemPath) {
            if (((Get-Item -LiteralPath $itemPath -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing to update through a symbolic link or junction: $itemPath"
            }
        }
        if ($itemPath -eq $vault) { break }
        $itemPath = Split-Path $itemPath -Parent
    }
}
Assert-PlainPath (Join-Path $vault '.obsidian')
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('obsidian-plugin-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$lock = $null
try {
    $releaseTag = $null
    if ($PSCmdlet.ParameterSetName -eq 'GitHub') {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $headers = @{ 'User-Agent' = 'MyObsidianPlugins-Updater'; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
        $endpoint = if ($Tag -eq 'latest') { 'latest' } else { 'tags/' + [uri]::EscapeDataString($Tag) }
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/$endpoint" -Headers $headers
        $releaseTag = $release.tag_name
        if ($releaseTag -notmatch '^plugins-[A-Za-z0-9][A-Za-z0-9-]{0,79}$') { throw 'Unexpected release tag.' }
        foreach ($name in @('obsidian-plugins.zip', 'SHA256SUMS')) {
            $assets = @($release.assets | Where-Object { $_.name -ceq $name })
            if ($assets.Count -ne 1 -or $assets[0].size -gt 33554432) { throw "Missing, duplicate or oversized release asset: $name" }
            $assetUrl = [uri]$assets[0].browser_download_url
            $expectedPath = "/$Repo/releases/download/$releaseTag/$name"
            if ($assetUrl.Scheme -cne 'https' -or $assetUrl.Host -cne 'github.com' -or $assetUrl.AbsolutePath -cne $expectedPath) { throw 'Unexpected release asset URL.' }
            Invoke-WebRequest -UseBasicParsing -Uri $assetUrl.AbsoluteUri -OutFile (Join-Path $temporary $name) | Out-Null
        }
        $archivePath = Join-Path $temporary 'obsidian-plugins.zip'
        $checksumsPath = Join-Path $temporary 'SHA256SUMS'
    } else {
        $archivePath = (Resolve-Path -LiteralPath $PackagePath).Path
        $checksumsPath = Join-Path (Split-Path $archivePath -Parent) 'SHA256SUMS'
    }
    $checksums = (Get-Content -LiteralPath $checksumsPath -Raw).Trim()
    if ($checksums -notmatch '^([a-fA-F0-9]{64})  obsidian-plugins\.zip$') { throw 'Invalid SHA256SUMS file.' }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ine $Matches[1]) { throw 'Archive checksum mismatch; no plugin files were changed.' }
    $expectedEntries = @('bundle.json')
    foreach ($id in @('home-widgets', 'my-calendar')) {
        foreach ($name in @('main.js', 'manifest.json', 'styles.css')) { $expectedEntries += "$id/$name" }
    }
    $stage = Join-Path $temporary 'content'
    New-Item -ItemType Directory -Path $stage | Out-Null
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entries = @($archive.Entries)
        if ($entries.Count -ne $expectedEntries.Count) { throw 'Unexpected archive contents.' }
        foreach ($name in $expectedEntries) {
            $matching = @($entries | Where-Object { $_.FullName -ceq $name })
            if ($matching.Count -ne 1 -or $matching[0].Length -gt 16777216) { throw "Missing, duplicate or oversized entry: $name" }
            $destination = Join-Path $stage $name
            New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($matching[0], $destination)
        }
    } finally { $archive.Dispose() }
    $bundle = Get-Content -LiteralPath (Join-Path $stage 'bundle.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($bundle.schema -ne 1 -or @($bundle.plugins).Count -ne 2 -or $bundle.tag -notmatch '^plugins-[A-Za-z0-9][A-Za-z0-9-]{0,79}$' -or $bundle.commit -notmatch '^[a-f0-9]{40}$') { throw 'Unsupported bundle metadata.' }
    if ($releaseTag -and $bundle.tag -cne $releaseTag) { throw 'Bundle does not match the requested release.' }
    $operations = @()
    foreach ($id in @('home-widgets', 'my-calendar')) {
        $plugins = @($bundle.plugins | Where-Object { $_.id -ceq $id })
        if ($plugins.Count -ne 1 -or @($plugins[0].files).Count -ne 3) { throw "Invalid plugin metadata: $id" }
        $manifest = Get-Content -LiteralPath (Join-Path $stage "$id/manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.id -cne $id -or $manifest.version -cne $plugins[0].version) { throw "Manifest mismatch: $id" }
        foreach ($name in @('main.js', 'manifest.json', 'styles.css')) {
            $records = @($plugins[0].files | Where-Object { $_.name -ceq $name })
            $source = Join-Path $stage "$id/$name"
            if ($records.Count -ne 1 -or $records[0].sha256 -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $source).Hash -ine $records[0].sha256) { throw "File checksum mismatch: $id/$name" }
            $target = Join-Path $vault ".obsidian/plugins/$id/$name"
            Assert-PlainPath $target
            if ((Test-Path -LiteralPath $target) -and -not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Expected a regular file: $target" }
            $operations += [pscustomobject]@{ Source = $source; Target = $target; Relative = "$id/$name"; Hash = $records[0].sha256; Existed = $false }
        }
    }
    Write-Output "Validated $($bundle.tag), source commit $($bundle.commit)"
    if ($CheckOnly) { Write-Output 'Check only: no installed plugin files changed.'; return }
    $lockPath = Join-Path $vault '.obsidian/plugin-update.lock'
    Assert-PlainPath $lockPath
    $lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $changed = @($operations | Where-Object { -not (Test-Path -LiteralPath $_.Target -PathType Leaf) -or (Get-FileHash -LiteralPath $_.Target).Hash -ine $_.Hash })
    if ($changed.Count -eq 0) { Write-Output 'Already up to date.'; return }
    $backup = Join-Path $vault ('.obsidian/plugin-update-backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
    Assert-PlainPath $backup
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    # Save every original code file before changing any installed plugin file.
    foreach ($operation in $operations) {
        if (Test-Path -LiteralPath $operation.Target -PathType Leaf) {
            $operation.Existed = $true
            $saved = Join-Path $backup $operation.Relative
            New-Item -ItemType Directory -Path (Split-Path $saved -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $operation.Target -Destination $saved
        }
    }
    $written = @()
    try {
        foreach ($operation in $operations) {
            New-Item -ItemType Directory -Path (Split-Path $operation.Target -Parent) -Force | Out-Null
            # Include the current file in rollback even if copying fails part way through.
            $written += $operation
            Copy-Item -LiteralPath $operation.Source -Destination $operation.Target -Force
            if ((Get-FileHash -LiteralPath $operation.Target).Hash -ine $operation.Hash) { throw "Installed checksum mismatch: $($operation.Relative)" }
        }
    } catch {
        $installationError = $_
        foreach ($operation in $written) {
            try {
                if ($operation.Existed) { Copy-Item -LiteralPath (Join-Path $backup $operation.Relative) -Destination $operation.Target -Force }
                elseif (Test-Path -LiteralPath $operation.Target -PathType Leaf) { Remove-Item -LiteralPath $operation.Target -Force }
            } catch { Write-Warning "Restore failed: $($operation.Relative). Original code is in $backup" }
        }
        throw $installationError
    }
    Write-Output "Installed $($bundle.tag). Previous code: $backup"
    Write-Output 'Reopen Obsidian to load the update. data.json, layouts and notes were preserved.'
} finally {
    if ($lock) { $lock.Dispose() }
    # temporary is a fresh GUID directory created by this invocation, never a vault path.
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $resolvedTemporary = [System.IO.Path]::GetFullPath($temporary)
    if ($resolvedTemporary.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTemporary -Leaf) -match '^obsidian-plugin-update-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
    }
}
