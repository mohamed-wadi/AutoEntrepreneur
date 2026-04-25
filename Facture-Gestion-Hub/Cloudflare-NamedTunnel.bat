@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul 2>&1
title Cloudflare Named Tunnel (1-click) -> localhost:19509

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
echo === 1) Demarrage du site local ===
echo (Docker doit etre demarre)
call "%SCRIPTDIR%DEMARRER.bat"

echo.
echo === 2) Verification du tunnel nomme ===
echo Tunnel: %TUNNEL_NAME%
"%CFEXE%" tunnel list | findstr /I /C:"%TUNNEL_NAME%" >nul 2>&1
if errorlevel 1 (
  echo.
  echo Tunnel introuvable: creation + route DNS...
  echo.
  echo === 2a) Login Cloudflare (ouvre le navigateur) ===
  "%CFEXE%" tunnel login
  if errorlevel 1 (
    echo ECHEC login.
    pause
    exit /b 1
  )

  echo.
  echo === 2b) Creation du tunnel ===
  "%CFEXE%" tunnel create "%TUNNEL_NAME%"
  if errorlevel 1 (
    echo ECHEC creation tunnel.
    pause
    exit /b 1
  )

  echo.
  echo === 2c) Route DNS ===
  echo Hostname: %TUNNEL_HOSTNAME%
  "%CFEXE%" tunnel route dns "%TUNNEL_NAME%" "%TUNNEL_HOSTNAME%"
  if errorlevel 1 (
    echo ECHEC route dns.
    pause
    exit /b 1
  )
) else (
  echo Tunnel deja existant. OK.
)

echo.
echo === 3) Lancement du tunnel (URL stable) ===
echo URL publique : https://%TUNNEL_HOSTNAME%
echo Gardez cette fenetre ouverte.
echo Ctrl+C pour arreter.
echo.
"%CFEXE%" tunnel --url "%LOCAL_URL%" run "%TUNNEL_NAME%"

echo.
pause
endlocal
exit /b 0
