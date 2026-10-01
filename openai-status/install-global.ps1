param([string]$Destination)

$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot ".opencode"
$profileRoot = [Environment]::GetFolderPath("UserProfile")
if (-not $Destination) {
  $Destination = Join-Path $profileRoot ".config\opencode"
}
$destination = $Destination
$pluginDirectory = Join-Path $destination "plugins\openai-status"

# Copy the v2 plugin package (index.ts + tui.tsx + package.json + lib/).
New-Item -ItemType Directory -Force -Path $pluginDirectory | Out-Null
foreach ($file in @("package.json", "index.ts", "tui.tsx")) {
  Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $pluginDirectory $file) -Force
}
$libSource = Join-Path $source "lib"
if (Test-Path -LiteralPath $libSource) {
  Copy-Item -LiteralPath $libSource -Destination $pluginDirectory -Recurse -Force
}

# Merge runtime dependencies into the global package.json.
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
if ($package.dependencies.PSObject.Properties["@opencode-ai/plugin"]) {
  $package.dependencies | Remove-Member -Name "@opencode-ai/plugin"
}
$package | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $packagePath -Encoding utf8

# Register the package in opencode.json under the v2 `plugins` key.
$configPath = Join-Path $destination "opencode.json"
$config = if (Test-Path -LiteralPath $configPath) {
  Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
} else {
  [pscustomobject]@{ '$schema' = "https://opencode.ai/config.json"; plugins = @() }
}
if (-not $config.PSObject.Properties["plugins"]) {
  $config | Add-Member -NotePropertyName plugins -NotePropertyValue @()
}
$targetPackage = "./plugins/openai-status"
$entry = [pscustomobject]@{ package = $targetPackage }
$filtered = @($config.plugins | Where-Object {
  $pkg = if ($_.PSObject.Properties["package"]) { $_.package } else { $_ }
  $pkg -ne $targetPackage
})
$config.plugins = @($filtered) + $entry
$config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding utf8

# Remove the V1 flat entry point and V1 TUI config.
$legacy = @(
  (Join-Path $destination "plugins\openai-status.ts"),
  (Join-Path $destination "lib"),
  (Join-Path $destination "tui.json")
)
foreach ($item in $legacy) {
  if (Test-Path -LiteralPath $item) {
    $itemInfo = Get-Item -LiteralPath $item
    if ($itemInfo.PSIsContainer) { Remove-Item -LiteralPath $item -Recurse -Force }
    else { Remove-Item -LiteralPath $item -Force }
  }
}

Write-Host "OpenAI status plugin installed in:"
Write-Host $destination
Write-Host "Restart OpenCode to load it."
