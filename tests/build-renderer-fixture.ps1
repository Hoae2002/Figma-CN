# Evaluate only the payload builder functions, never the installer entry point.
param([switch]$Main)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$repo = Split-Path -Parent $PSScriptRoot
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'src\FigBoost.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Invalid installer syntax' }
$names = @('Read-PayloadText', 'ConvertTo-JsString', 'Build-Payload', 'Build-MainPayload')
foreach ($name in $names) {
  $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (!$definition) { throw "Missing builder function: $name" }
  Invoke-Expression $definition.Extent.Text
}
function Get-BaseDir { return $repo }
$EmbeddedPayloadFiles = @{}
[Console]::Write($(if ($Main) { Build-MainPayload } else { Build-Payload }))
