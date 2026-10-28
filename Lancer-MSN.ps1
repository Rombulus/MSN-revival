$ErrorActionPreference = 'Stop'
$clientUrl = 'http://127.0.0.1:4173'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Installe Node.js 22 ou plus recent pour lancer MSN Revival.' }
$running = $false
try { $status = Invoke-RestMethod -Uri "$clientUrl/api/status" -TimeoutSec 2; $running = $status.PSObject.Properties.Name -contains 'connected' } catch {}
if (-not $running) {
  $logDir = Join-Path $PSScriptRoot '.local'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $serverFile = Join-Path $PSScriptRoot 'server.mjs'
  Start-Process -FilePath $nodeCommand.Source -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log')
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { $status = Invoke-RestMethod -Uri "$clientUrl/api/status" -TimeoutSec 2; $running = $status.PSObject.Properties.Name -contains 'connected'; if ($running) { break } } catch {}
    Start-Sleep -Milliseconds 200
  }
  if (-not $running) { throw 'Le client local ne demarre pas. Consulte .local/server-error.log.' }
}
$edgeCandidates = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'), (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'))
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($edgePath) { Start-Process -FilePath $edgePath -ArgumentList @('--app=' + $clientUrl, '--window-size=1240,860') }
else { Start-Process $clientUrl }
