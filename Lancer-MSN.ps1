$ErrorActionPreference = 'Stop'
$clientUrl = 'http://127.0.0.1:4173'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Installe Node.js 22 ou plus recent pour lancer MSN Revival.' }
$running = $false
try { $page = Invoke-WebRequest -UseBasicParsing -Uri "$clientUrl/" -TimeoutSec 2; $running = $page.StatusCode -eq 200 -and $page.Content.Contains('MSN Revival') } catch {}
if (-not $running) {
  $logDir = Join-Path $PSScriptRoot '.local'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $serverFile = Join-Path $PSScriptRoot 'server.mjs'
  Start-Process -FilePath $nodeCommand.Source -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log')
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { $page = Invoke-WebRequest -UseBasicParsing -Uri "$clientUrl/" -TimeoutSec 2; $running = $page.StatusCode -eq 200 -and $page.Content.Contains('MSN Revival'); if ($running) { break } } catch {}
    Start-Sleep -Milliseconds 200
  }
  if (-not $running) { throw 'Le client local ne demarre pas. Consulte .local/server-error.log.' }
}
$edgeCandidates = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'), (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'))
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($edgePath) {
  $profileDir = Join-Path $env:LOCALAPPDATA 'MSN Revival\Edge'
  Start-Process -FilePath $edgePath -ArgumentList @(('--user-data-dir="' + $profileDir + '"'), ('--app=' + $clientUrl), '--start-maximized')
}
else { Start-Process $clientUrl }
