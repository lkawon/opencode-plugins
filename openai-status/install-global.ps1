param([string]$Destination)

$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot ".opencode"
$profileRoot = [Environment]::GetFolderPath("UserProfile")
if (-not $Destination) {
  $Destination = Join-Path $profileRoot ".config\opencode"
}
$destination = $Destination
$pluginDirectory = Join-Path $destination "plugins\openai-status"

New-Item -ItemType Directory -Force -Path $pluginDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $source "plugins\openai-status.ts") -Destination (Join-Path $destination "plugins\openai-status.ts") -Force
Copy-Item -LiteralPath (Join-Path $source "plugins\openai-status\tui.tsx") -Destination (Join-Path $pluginDirectory "tui.tsx") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $destination "lib") | Out-Null
Copy-Item -LiteralPath (Join-Path $source "lib\openai-status.ts") -Destination (Join-Path $destination "lib\openai-status.ts") -Force

$sourcePackage = Get-Content -LiteralPath (Join-Path $source "package.json") -Raw | ConvertFrom-Json
$packagePath = Join-Path $destination "package.json"
$package = if (Test-Path -LiteralPath $packagePath) {
  Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
} else {
  [pscustomobject]@{ type = "module"; dependencies = [pscustomobject]@{} }
}
if (-not $package.PSObject.Properties["dependencies"]) {
  $package | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
}
foreach ($dependency in $sourcePackage.dependencies.PSObject.Properties) {
  $package.dependencies | Add-Member -NotePropertyName $dependency.Name -NotePropertyValue $dependency.Value -Force
}
$package | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $packagePath -Encoding utf8

$tuiPath = Join-Path $destination "tui.json"
$config = if (Test-Path -LiteralPath $tuiPath) {
  Get-Content -LiteralPath $tuiPath -Raw | ConvertFrom-Json
} else {
  [pscustomobject]@{ '$schema' = "https://opencode.ai/tui.json"; plugin = @() }
}
if (-not $config.PSObject.Properties["plugin"]) {
  $config | Add-Member -NotePropertyName plugin -NotePropertyValue @()
}
$entry = "./plugins/openai-status/tui.tsx"
$config.plugin = @($config.plugin | Where-Object { $_ -ne $entry }) + $entry
$config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $tuiPath -Encoding utf8

Write-Host "OpenAI status plugin installed in:"
Write-Host $destination
Write-Host "Restart OpenCode to load it."
