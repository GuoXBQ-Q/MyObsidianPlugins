[CmdletBinding(DefaultParameterSetName = 'Increment')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Explicit')]
    [ValidatePattern('^plugins-(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
    [string]$Tag,
    [Parameter(ParameterSetName = 'Increment')]
    [ValidateSet('Patch', 'Minor', 'Major')]
    [string]$Bump = 'Patch'
)
$ErrorActionPreference = 'Stop'

function Get-NextPluginTag([string[]]$Tags, [string]$Bump) {
    $versions = @($Tags | Where-Object { $_ -cmatch '^plugins-(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' } |
        ForEach-Object { [version]$_.Substring(8) } | Sort-Object -Descending)
    if ($versions.Count -eq 0) {
        if ($Bump -eq 'Major') { return 'plugins-1.0.0' }
        return 'plugins-0.1.0'
    }
    $latest = $versions[0]
    switch ($Bump) {
        'Major' { return ('plugins-{0}.0.0' -f ($latest.Major + 1)) }
        'Minor' { return ('plugins-{0}.{1}.0' -f $latest.Major, ($latest.Minor + 1)) }
        'Patch' { return ('plugins-{0}.{1}.{2}' -f $latest.Major, $latest.Minor, ($latest.Build + 1)) }
        default { throw "Unsupported version increment: $Bump" }
    }
}

$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
    $changes = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read Git status.' }
    if ($changes.Count -gt 0) { throw 'Commit your source changes before publishing.' }
    $branch = & git symbolic-ref --short HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Publish from a branch, not a detached HEAD.' }
    $remote = & git remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $remote -notmatch '^(https://github\.com/|git@github\.com:)GuoXBQ-Q/MyObsidianPlugins(\.git)?$') {
        throw 'origin must point to GuoXBQ-Q/MyObsidianPlugins on GitHub.'
    }
    & git fetch origin --tags
    if ($LASTEXITCODE -ne 0) { throw 'Cannot fetch release tags; stopped to avoid choosing an outdated version.' }
    if (-not $Tag) {
        $knownTags = @(& git tag --list 'plugins-*')
        if ($LASTEXITCODE -ne 0) { throw 'Cannot read release tags.' }
        $Tag = Get-NextPluginTag -Tags $knownTags -Bump $Bump
    }
    & git show-ref --verify --quiet "refs/tags/$Tag"
    if ($LASTEXITCODE -eq 0) { throw "Tag already exists: $Tag" }
    if ($LASTEXITCODE -ne 1) { throw 'Cannot check release tags.' }
    & git tag -a $Tag -m "release: publish plugin builds $Tag"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create release tag.' }
    & git push --atomic origin "HEAD:refs/heads/$branch" "refs/tags/$Tag"
    if ($LASTEXITCODE -ne 0) {
        throw "Push failed. Local tag $Tag was retained. After fixing access/network errors, retry: git push --atomic origin HEAD:refs/heads/$branch refs/tags/$Tag"
    }
    Write-Output "Release queued: $Tag"
    Write-Output 'Build progress: https://github.com/GuoXBQ-Q/MyObsidianPlugins/actions'
    Write-Output 'Download when ready: https://github.com/GuoXBQ-Q/MyObsidianPlugins/releases/latest'
} finally {
    Pop-Location
}
