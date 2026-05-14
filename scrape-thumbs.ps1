# Scrapes reverse.estate photo pages to find direct image URLs.
# Saves { id: imageUrl } to thumb-map.json.
#
# Usage:  powershell -File scrape-thumbs.ps1
#         powershell -File scrape-thumbs.ps1 -Limit 100 -Last
#         powershell -File scrape-thumbs.ps1 -Concurrency 10

param(
    [int]$Concurrency = 5,
    [int]$Limit = 0,
    [switch]$Last
)

$sheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0D8NXWZ7ViUeHxH0XNdGycpf0fxaAEHAYqDGrMIbNYo4mrjT3WdoSjcPSeHO6TQ/pub?output=csv"
$mapFile = Join-Path $PSScriptRoot "thumb-map.json"

# Load existing map
$map = @{}
if (Test-Path $mapFile) {
    try {
        $json = Get-Content $mapFile -Raw | ConvertFrom-Json
        $json.PSObject.Properties | ForEach-Object { $map[$_.Name] = $_.Value }
        Write-Host "Loaded existing map: $($map.Count) entries"
    } catch { Write-Host "Could not load existing map, starting fresh" }
}

# Download CSV
Write-Host "Downloading spreadsheet..."
$wc = New-Object System.Net.WebClient
$wc.Encoding = [System.Text.Encoding]::UTF8
$csv = $wc.DownloadString($sheetUrl)

# Parse unique IDs (primary rows only)
$allIds = @()
foreach ($line in ($csv -split "`n" | Select-Object -Skip 1)) {
    if ($line -match '^(\d+),([^,]+),') {
        $id = $Matches[1]
        if ($id -notin $allIds) { $allIds += $id }
    }
}

# Filter to IDs not yet in map
$todo = $allIds | Where-Object { -not $map.ContainsKey($_) }
if ($Last) {
    $n = if ($Limit -gt 0) { $Limit } else { 100 }
    $todo = $todo | Select-Object -Last $n
} elseif ($Limit -gt 0) {
    $todo = $todo | Select-Object -First $Limit
}

$total = @($todo).Count
Write-Host "$($allIds.Count) listings, $($map.Count) cached, $total to scrape"

if ($total -eq 0) {
    Write-Host "Nothing new to scrape."
    exit 0
}

# Scrape in parallel using runspace pool
$pool = [runspacefactory]::CreateRunspacePool(1, $Concurrency)
$pool.Open()

$scriptBlock = {
    param($id)
    try {
        $wc = New-Object System.Net.WebClient
        $wc.Encoding = [System.Text.Encoding]::UTF8
        $html = $wc.DownloadString("https://reverse.estate/photos/$id")
        if ($html -match 'src="(/storage/photos/[^"]*?/0\.jpg[^"]*)"') {
            return @{ Id = $id; Url = "https://reverse.estate$($Matches[1])"; Ok = $true }
        }
        return @{ Id = $id; Url = $null; Ok = $false }
    } catch {
        return @{ Id = $id; Url = $null; Ok = $false }
    }
}

$jobs = @()
foreach ($id in $todo) {
    $ps = [powershell]::Create().AddScript($scriptBlock).AddArgument($id)
    $ps.RunspacePool = $pool
    $jobs += @{ Pipe = $ps; Handle = $ps.BeginInvoke() }
}

$done = 0
$failed = 0
foreach ($job in $jobs) {
    $result = $job.Pipe.EndInvoke($job.Handle)
    $job.Pipe.Dispose()
    $done++
    if ($result.Ok -and $result.Url) {
        $map[$result.Id] = $result.Url
    } else {
        $failed++
    }
    if ($done % 50 -eq 0 -or $done -eq $total) {
        $pct = [math]::Round($done / $total * 100)
        Write-Host "$done / $total ($pct%) - $($map.Count) mapped, $failed failed"
    }
}

$pool.Close()
$pool.Dispose()

# Save
$map | ConvertTo-Json -Compress | Set-Content $mapFile -Encoding UTF8
Write-Host "Done. $($map.Count) entries saved to thumb-map.json"
