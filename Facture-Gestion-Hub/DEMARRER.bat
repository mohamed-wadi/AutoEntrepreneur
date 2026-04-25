@echo off
cd /d "%~dp0"

rem Start from existing local images first (works even if Docker Hub DNS is down)
docker compose up -d
if errorlevel 1 (
  echo.
  echo Echec demarrage sans rebuild. Tentative avec rebuild...
  docker compose up -d --build
)
if errorlevel 1 (
  echo Echec demarrage Docker compose.
  echo Verifiez Docker Desktop + connexion Internet + DNS.
  echo Test rapide: nslookup registry-1.docker.io
  pause
  exit /b 1
)
timeout /t 20 /nobreak >nul
start "" "http://localhost:19509"
