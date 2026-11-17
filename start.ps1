param([switch]$CreateOwner, [switch]$ResetPassword)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $financeNode = $nodeCommand.Source }
else {
  $runtimePackage = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' | Sort-Object Version -Descending | Select-Object -First 1
  if ($runtimePackage) { $financeNode = Join-Path $runtimePackage.InstallLocation 'dependencies\node\bin\node.exe' }
}
if (-not $financeNode -or -not (Test-Path -LiteralPath $financeNode)) { throw 'Установи Node.js 24 и повтори запуск.' }
if (-not (Test-Path -LiteralPath '.env')) { throw 'Сначала настрой .env по README.md.' }
docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) {
  $dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (Test-Path -LiteralPath $dockerDesktop) { Start-Process -FilePath $dockerDesktop -WindowStyle Hidden }
  $dockerReady = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
  }
  if (-not $dockerReady) { throw 'Дождись запуска Docker Desktop и повтори.' }
}
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw 'Не удалось запустить базу данных.' }
if ($ResetPassword) {
  & $financeNode 'node_modules/tsx/dist/cli.mjs' 'scripts/create-owner.ts' --reset-password
} elseif ($CreateOwner) {
  & $financeNode 'node_modules/tsx/dist/cli.mjs' 'scripts/create-owner.ts'
} else {
  if (-not (Test-Path -LiteralPath '.next\BUILD_ID')) { throw 'Нет сборки. Выполни pnpm run build.' }
  Write-Host 'Открой http://localhost:3000. Для остановки нажми Ctrl+C.'
  & $financeNode 'node_modules/next/dist/bin/next' start --hostname 127.0.0.1 --port 3000
}
