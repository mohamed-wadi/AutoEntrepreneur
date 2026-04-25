@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul 2>&1
title Cloudflare Named Tunnel - RUN -> localhost:19509

set "LOCAL_URL=http://localhost:19509"
set "CFDIR=%LOCALAPPDATA%\cloudflared"
set "CFEXE=%CFDIR%\cloudflared.exe"
set "SCRIPTDIR=%~dp0"

rem Fix frequent Windows DNS timeout issues for cloudflared
set "TUNNEL_DNS_RESOLVER_ADDRS=1.1.1.1:53"

if not exist "%CFEXE%" (
  echo Telechargement de cloudflared ^(une seule fois^)...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPTDIR%scripts\install-cloudflared.ps1"
  if not exist "%CFEXE%" (
    echo ERREUR : telechargement impossible. Telechargez a la main :
    echo https://github.com/cloudflare/cloudflared/releases/latest
    echo Fichier : cloudflared-windows-amd64.exe -^> renommez en cloudflared.exe dans :
    echo %CFDIR%
    pause
    exit /b 1
  )
)

if not exist "cloudflare-tunnel.env" (
  echo Fichier cloudflare-tunnel.env introuvable.
  echo Copiez cloudflare-tunnel.env.example vers cloudflare-tunnel.env puis remplissez-le.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%A in ("cloudflare-tunnel.env") do set "%%A"

if "%TUNNEL_NAME%"=="" (
  echo TUNNEL_NAME est vide dans cloudflare-tunnel.env
  pause
  exit /b 1
)

echo.
echo === Tunnel Cloudflare NOMME (stable) ===
echo Cible : %LOCAL_URL%
echo Tunnel : %TUNNEL_NAME%
echo URL publique : https://%TUNNEL_HOSTNAME%  ^(si route DNS configuree^)
echo Gardez cette fenetre ouverte.
echo Ctrl+C pour arreter.
echo.

rem Run tunnel named: uses credentials file created by `tunnel create`
"%CFEXE%" tunnel --url "%LOCAL_URL%" run "%TUNNEL_NAME%"

echo.
pause
endlocal
exit /b 0
