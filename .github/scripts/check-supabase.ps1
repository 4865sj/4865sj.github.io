$ErrorActionPreference = 'Stop'

# Reuse only the public browser configuration; no admin credentials are needed.
$boardSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot '../../board.js')
$projectUrl = [regex]::Match($boardSource, 'const SUPABASE_URL = "([^"]+)";').Groups[1].Value
$publishableKey = [regex]::Match($boardSource, 'const PUBLISHABLE_KEY = "([^"]+)";').Groups[1].Value
if ($projectUrl -notmatch '^https://[a-z0-9]+\.supabase\.co$' -or
    $publishableKey -notmatch '^sb_publishable_[A-Za-z0-9_-]+$') {
    throw 'Expected the public Supabase URL and publishable key in board.js.'
}

# This is an actual database read, not a cached homepage or an Auth health ping.
# RLS remains in effect. Select at most one public ID and never print the data.
$requestUri = $projectUrl + '/rest/v1/board_messages?select=id&limit=1'
$requestHeaders = @{
    apikey = $publishableKey
    Accept = 'application/json'
    'Cache-Control' = 'no-cache'
}

for ($attempt = 1; $attempt -le 4; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $requestUri -Method Get `
            -Headers $requestHeaders -MaximumRedirection 0 -TimeoutSec 20
    } catch {
        $statusCode = 0
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($statusCode -eq 540) {
            throw 'Supabase is paused. Resume the project from the Supabase dashboard; this check cannot restore it.'
        }
        $transient = $statusCode -eq 0 -or $statusCode -eq 408 -or
            $statusCode -eq 429 -or $statusCode -ge 500
        if (-not $transient -or $attempt -eq 4) {
            throw "Supabase database read failed (HTTP $statusCode; 0 means a network error). Check project availability and its public read policy."
        }
        Write-Warning "Temporary database check failure (HTTP $statusCode). Retrying."
        Start-Sleep -Seconds (5 * [math]::Pow(2, $attempt - 1))
        continue
    }

    if ([int]$response.StatusCode -ne 200) {
        throw 'Supabase returned an unexpected status instead of a successful database read.'
    }
    $body = $response.Content.Trim()
    if (-not $body.StartsWith('[') -or -not $body.EndsWith(']')) {
        throw 'Supabase did not return the expected JSON array.'
    }
    try {
        $rows = @($body | ConvertFrom-Json)
    } catch {
        throw 'Supabase returned invalid JSON.'
    }
    if ($rows.Count -gt 1) {
        throw 'Supabase returned more rows than the read limit allows.'
    }

    # An empty Board is healthy too; do not create artificial posts or scores.
    Write-Output 'Supabase database read succeeded (HTTP 200). No data was changed.'
    return
}
