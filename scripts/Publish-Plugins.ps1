[CmdletBinding()]
param(
    [ValidatePattern('^plugins-[A-Za-z0-9][A-Za-z0-9-]{0,79}$')]
    [string]$Tag
)
$ErrorActionPreference = 'Stop'
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
    if (-not $Tag) {
        $shortCommit = & git rev-parse --short HEAD
        if ($LASTEXITCODE -ne 0) { throw 'Cannot read source commit.' }
        $Tag = 'plugins-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $shortCommit.Trim()
    }
    & git show-ref --verify --quiet "refs/tags/$Tag"
    if ($LASTEXITCODE -eq 0) { throw "Tag already exists: $Tag" }
    if ($LASTEXITCODE -ne 1) { throw 'Cannot check release tags.' }
    & git tag -a $Tag -m "release: publish plugin bundle $Tag"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create release tag.' }
    & git push --atomic origin "HEAD:refs/heads/$branch" "refs/tags/$Tag"
    if ($LASTEXITCODE -ne 0) {
        throw "Push failed. Local tag $Tag was retained; fix access/network errors, then retry the displayed git push command."
    }
    Write-Output "Release queued: $Tag"
    Write-Output 'Build progress: https://github.com/GuoXBQ-Q/MyObsidianPlugins/actions'
    Write-Output 'Download when ready: https://github.com/GuoXBQ-Q/MyObsidianPlugins/releases/latest'
} finally {
    Pop-Location
}
