@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul 2>&1
title Acces Internet Cloudflare Tunnel - localhost:19509

set "LOCAL_URL=http://localhost:19509"
set "CFDIR=%LOCALAPPDATA%\cloudflared"
set "CFEXE=%CFDIR%\cloudflared.exe"
set "SCRIPTDIR=%~dp0"

rem Evite "Failed to initialize DNS local resolver ... i/o timeout" si le DNS Windows / la box ne repond pas assez vite
set "TUNNEL_DNS_RESOLVER_ADDRS=1.1.1.1:53"

echo.
echo === Tunnel Cloudflare vers votre site local ===
echo   Cible : %LOCAL_URL%
echo   Demarrez Docker et le site avant ^(DEMARRER.bat ou docker compose up^).
echo   VOTRE LIEN ^- quelques secondes plus bas, un cadre en +---+ avec une ligne du type :
echo     https://quelque-chose.trycloudflare.com  ^<- copiez cette ligne dans le navigateur ou le telephone.
echo   Gardez cette fenetre ouverte pour rester accessible sur Internet.
echo   Ctrl+C pour arreter le tunnel.
echo.

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
  echo.
)

echo --- Logs cloudflared ^(le lien est la ligne https dans le cadre +---^) ---
echo.
"%CFEXE%" tunnel --url "%LOCAL_URL%"

echo.
pause
endlocal
exit /b 0
