@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul 2>&1
title Cloudflare Named Tunnel - SETUP

set "CFDIR=%LOCALAPPDATA%\cloudflared"
set "CFEXE=%CFDIR%\cloudflared.exe"
set "SCRIPTDIR=%~dp0"

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
  echo 1^) Copiez cloudflare-tunnel.env.example vers cloudflare-tunnel.env
  echo 2^) Remplissez TUNNEL_NAME et TUNNEL_HOSTNAME
  pause
  exit /b 1
)

for /f "usebackq delims=" %%A in ("cloudflare-tunnel.env") do set "%%A"

if "%TUNNEL_NAME%"=="" (
  echo TUNNEL_NAME est vide dans cloudflare-tunnel.env
  pause
  exit /b 1
)
if "%TUNNEL_HOSTNAME%"=="" (
  echo TUNNEL_HOSTNAME est vide dans cloudflare-tunnel.env
  pause
  exit /b 1
)

echo.
echo === ETAPE 1/3 : Login Cloudflare (ouvre le navigateur) ===
echo Connectez-vous au compte Cloudflare qui gere votre domaine.
echo.
"%CFEXE%" tunnel login
if errorlevel 1 (
  echo ECHEC login.
  pause
  exit /b 1
)

echo.
echo === ETAPE 2/3 : Creation du tunnel nomme ===
"%CFEXE%" tunnel create "%TUNNEL_NAME%"
if errorlevel 1 (
  echo ECHEC creation tunnel.
  pause
  exit /b 1
)

echo.
echo === ETAPE 3/3 : Route DNS vers votre tunnel ===
echo Hostname: %TUNNEL_HOSTNAME%
"%CFEXE%" tunnel route dns "%TUNNEL_NAME%" "%TUNNEL_HOSTNAME%"
if errorlevel 1 (
  echo ECHEC route dns.
  pause
  exit /b 1
)

echo.
echo OK. Vous pouvez maintenant lancer le tunnel via:
echo   Cloudflare-NamedTunnel-2-RUN.bat
echo.
pause
endlocal
exit /b 0
