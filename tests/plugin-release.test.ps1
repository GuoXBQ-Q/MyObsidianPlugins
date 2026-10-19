# Behavior checks use disposable vaults and never touch real notes or plugin data.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$PackagePath)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$updater = Join-Path $repoRoot 'scripts/Update-Plugins.ps1'
$package = (Resolve-Path -LiteralPath $PackagePath).Path
Add-Type -AssemblyName System.IO.Compression.FileSystem
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('plugin-release-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
function Assert-Equal($Actual, $Expected, [string]$Label) {
    if ($Actual -cne $Expected) { throw "Assertion failed: $Label" }
}
function New-TestVault([string]$Name) {
    $target = Join-Path $work $Name
    foreach ($id in @('home-widgets', 'my-calendar')) {
        $directory = Join-Path $target ".obsidian/plugins/$id"
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        foreach ($file in @('main.js', 'manifest.json', 'styles.css')) {
            "previous code: $id/$file" | Set-Content -LiteralPath (Join-Path $directory $file) -Encoding ASCII
        }
        '{"events":["keep my data"]}' | Set-Content -LiteralPath (Join-Path $directory 'data.json') -Encoding ASCII
        'another plugin file' | Set-Content -LiteralPath (Join-Path $directory 'custom.txt') -Encoding ASCII
    }
    New-Item -ItemType Directory -Path (Join-Path $target 'Home') | Out-Null
    'keep my layout' | Set-Content -LiteralPath (Join-Path $target 'Home/widgets.json') -Encoding ASCII
    return $target
}
function Get-PluginSnapshot([string]$Vault) {
    return ((Get-ChildItem -LiteralPath (Join-Path $Vault '.obsidian/plugins') -Recurse -File | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($Vault.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName).Hash
    }) -join "`n")
}
function Assert-Rejected([scriptblock]$Action, [string]$MessagePattern) {
    $rejected = $false
    try { & $Action } catch {
        if ($_.Exception.Message -notmatch $MessagePattern) { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw 'Expected the updater to reject invalid input.' }
}
function Copy-TestPackage([string]$Name) {
    $directory = Join-Path $work $Name
    New-Item -ItemType Directory -Path $directory | Out-Null
    $destination = Join-Path $directory 'obsidian-plugins.zip'
    Copy-Item -LiteralPath $package -Destination $destination
    Copy-Item -LiteralPath (Join-Path (Split-Path $package -Parent) 'SHA256SUMS') -Destination $directory
    return $destination
}
function Write-Checksum([string]$Archive) {
    ((Get-FileHash -LiteralPath $Archive).Hash.ToLowerInvariant() + '  obsidian-plugins.zip') | Set-Content -LiteralPath (Join-Path (Split-Path $Archive -Parent) 'SHA256SUMS') -Encoding ASCII
}
try {
    $vault = New-TestVault 'check-only'
    $before = Get-PluginSnapshot $vault
    & $updater -VaultPath $vault -PackagePath $package -CheckOnly
    Assert-Equal (Get-PluginSnapshot $vault) $before 'CheckOnly preserves installed files'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $vault '.obsidian/plugin-update-backups')) $false 'CheckOnly creates no backup'
    Write-Output 'PASS: check-only performs no installation'

    $freshVault = Join-Path $work 'first-install'
    New-Item -ItemType Directory -Path (Join-Path $freshVault '.obsidian') -Force | Out-Null
    & $updater -VaultPath $freshVault -PackagePath $package
    foreach ($id in @('home-widgets', 'my-calendar')) {
        Assert-Equal (Test-Path -LiteralPath (Join-Path $freshVault ".obsidian/plugins/$id/main.js") -PathType Leaf) $true 'first installation writes code'
        Assert-Equal (Test-Path -LiteralPath (Join-Path $freshVault ".obsidian/plugins/$id/data.json")) $false 'first installation does not create sample data'
    }
    Write-Output 'PASS: first installation works without injecting sample data'

    $vault = New-TestVault 'normal'
    $dataHashes = @{}
    foreach ($id in @('home-widgets', 'my-calendar')) { $dataHashes[$id] = (Get-FileHash -LiteralPath (Join-Path $vault ".obsidian/plugins/$id/data.json")).Hash }
    & $updater -VaultPath $vault -PackagePath $package
    foreach ($id in @('home-widgets', 'my-calendar')) { Assert-Equal (Get-FileHash -LiteralPath (Join-Path $vault ".obsidian/plugins/$id/data.json")).Hash $dataHashes[$id] "preserve actual data: $id" }
    Assert-Equal (Get-Content -LiteralPath (Join-Path $vault 'Home/widgets.json') -Raw).Trim() 'keep my layout' 'preserve layout'
    $zip = [System.IO.Compression.ZipFile]::OpenRead($package)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -eq 'bundle.json') { continue }
            $reader = New-Object System.IO.StreamReader($entry.Open())
            try { $expected = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $installed = Join-Path $vault ('.obsidian/plugins/' + $entry.FullName)
            Assert-Equal (Get-Content -LiteralPath $installed -Raw -Encoding UTF8) $expected "installed $($entry.FullName)"
        }
    } finally { $zip.Dispose() }
    $backups = @(Get-ChildItem -LiteralPath (Join-Path $vault '.obsidian/plugin-update-backups') -Directory)
    Assert-Equal $backups.Count 1 'one backup'
    foreach ($id in @('home-widgets', 'my-calendar')) {
        Assert-Equal (Get-Content -LiteralPath (Join-Path $backups[0].FullName "$id/main.js") -Raw).Trim() "previous code: $id/main.js" 'original code saved'
        Assert-Equal (Get-Content -LiteralPath (Join-Path $vault ".obsidian/plugins/$id/custom.txt") -Raw).Trim() 'another plugin file' 'preserve unrelated plugin files'
    }
    & $updater -VaultPath $vault -PackagePath $package
    Assert-Equal @(Get-ChildItem -LiteralPath (Join-Path $vault '.obsidian/plugin-update-backups') -Directory).Count 1 'same version is a no-op'
    Write-Output 'PASS: both plugins installed, data preserved, originals backed up, repeated update is a no-op'

    $vault = New-TestVault 'rejected'
    $before = Get-PluginSnapshot $vault
    $bad = Copy-TestPackage 'bad-checksum'
    [System.IO.File]::AppendAllText($bad, 'broken download')
    Assert-Rejected { & $updater -VaultPath $vault -PackagePath $bad } 'Archive checksum mismatch'
    Assert-Equal (Get-PluginSnapshot $vault) $before 'bad download cannot alter plugins'
    Write-Output 'PASS: corrupt download rejected before installation'

    $bad = Copy-TestPackage 'unexpected-entry'
    $zip = [System.IO.Compression.ZipFile]::Open($bad, [System.IO.Compression.ZipArchiveMode]::Update)
    try { $null = $zip.CreateEntry('../outside.txt') } finally { $zip.Dispose() }
    Write-Checksum $bad
    Assert-Rejected { & $updater -VaultPath $vault -PackagePath $bad } 'Unexpected archive contents'
    Assert-Equal (Get-PluginSnapshot $vault) $before 'unexpected entry cannot alter plugins'
    Write-Output 'PASS: unexpected archive entry rejected'

    $bad = Copy-TestPackage 'bad-file'
    $zip = [System.IO.Compression.ZipFile]::Open($bad, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry = $zip.GetEntry('my-calendar/main.js')
        $entry.Delete()
        $writer = New-Object System.IO.StreamWriter($zip.CreateEntry('my-calendar/main.js').Open())
        try { $writer.Write('altered code') } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }
    Write-Checksum $bad
    Assert-Rejected { & $updater -VaultPath $vault -PackagePath $bad } 'File checksum mismatch'
    Assert-Equal (Get-PluginSnapshot $vault) $before 'bad inner file cannot alter plugins'
    Write-Output 'PASS: individual file checksum verified'

    $vault = New-TestVault 'rollback'
    $before = Get-PluginSnapshot $vault
    $failureState = [pscustomobject]@{ Target = (Join-Path $vault '.obsidian/plugins/my-calendar/main.js'); Failed = $false }
    $copyProxy = {
        param([string]$LiteralPath, [string]$Destination, [switch]$Force)
        if ($Destination -eq $failureState.Target -and -not $failureState.Failed) {
            $failureState.Failed = $true
            throw 'Simulated installation failure after Home Widgets was replaced.'
        }
        Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
    }.GetNewClosure()
    Set-Item -Path Function:\Copy-Item -Value $copyProxy
    try {
        Assert-Rejected { & $updater -VaultPath $vault -PackagePath $package } 'Simulated installation failure'
    } finally { Remove-Item Function:\Copy-Item }
    Assert-Equal (Get-PluginSnapshot $vault) $before 'failure restores original files in both plugins'
    Write-Output 'PASS: partial installation failure restores original code and preserves data'
    Write-Output 'All plugin release behavior checks passed.'
} finally {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $resolvedWork = [System.IO.Path]::GetFullPath($work)
    if ($resolvedWork.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedWork -Leaf) -match '^plugin-release-test-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolvedWork -Recurse -Force
    }
}
