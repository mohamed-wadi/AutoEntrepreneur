$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "cloudflared"
$exe = Join-Path $dir "cloudflared.exe"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
Write-Host "Download cloudflared -> $exe"
Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
Write-Host "OK."
