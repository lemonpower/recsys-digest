param([Parameter(Mandatory)][string]$SourcePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($SourcePath -cnotmatch '^(?:/|/(?:en/)?archive|/(?:en/)?article/(?:daily-report|ai-daily|ai-daily-en|rec-daily-en)-\d{4}-\d{2}-\d{2})$') { exit 2 }
try {
  $response = Invoke-WebRequest -Uri ('https://blog.recsys-frontier.com' + $SourcePath) -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 18 -SkipHttpErrorCheck
  if ($response.StatusCode -ne 200) { exit 3 }
  [Console]::Write([string]$response.Content)
} catch { exit 4 }
