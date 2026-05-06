$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $projectRoot ".env"

if (!(Test-Path -LiteralPath $envPath)) {
  throw ".env file not found: $envPath"
}

$currentLoginId = "admin"
foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $envPath) {
  if ($line -match '^\s*ADMIN_LOGIN_ID\s*=\s*(.*)\s*$') {
    $value = $matches[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($value) {
      $currentLoginId = $value
    }
  }
  elseif ($line -match '^\s*ADMIN_EMAIL\s*=\s*(.*)\s*$') {
    $value = $matches[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($value) {
      $currentLoginId = $value
    }
  }
}

$loginId = Read-Host "Login ID [$currentLoginId]"
if ([string]::IsNullOrWhiteSpace($loginId)) {
  $loginId = $currentLoginId
}

$securePassword = Read-Host "New password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrEmpty($password)) {
  throw "Password cannot be empty."
}

function Escape-EnvValue([string] $value) {
  return $value.Replace('\', '\\').Replace('"', '\"')
}

$lines = Get-Content -Encoding UTF8 -LiteralPath $envPath
$hasLoginId = $false
$hasPassword = $false
$updated = foreach ($line in $lines) {
  if ($line -match '^\s*ADMIN_LOGIN_ID\s*=') {
    $hasLoginId = $true
    "ADMIN_LOGIN_ID=""$(Escape-EnvValue $loginId)"""
  }
  elseif ($line -match '^\s*ADMIN_EMAIL\s*=') {
    $hasLoginId = $true
    "ADMIN_LOGIN_ID=""$(Escape-EnvValue $loginId)"""
  }
  elseif ($line -match '^\s*ADMIN_PASSWORD\s*=') {
    $hasPassword = $true
    "ADMIN_PASSWORD=""$(Escape-EnvValue $password)"""
  }
  else {
    $line
  }
}

if (!$hasLoginId) {
  $updated += "ADMIN_LOGIN_ID=""$(Escape-EnvValue $loginId)"""
}
if (!$hasPassword) {
  $updated += "ADMIN_PASSWORD=""$(Escape-EnvValue $password)"""
}

Set-Content -Encoding UTF8 -LiteralPath $envPath -Value $updated

Push-Location $projectRoot
try {
  npm run db:seed
}
finally {
  Pop-Location
}

Write-Host "Admin credentials updated for login ID: $loginId"
