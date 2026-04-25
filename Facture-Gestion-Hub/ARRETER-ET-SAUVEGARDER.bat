@echo off
cd /d "%~dp0"

echo Sauvegarde avant fermeture...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup-now.ps1"
if errorlevel 1 (
  echo.
  echo ECHEC BACKUP. Arret annule pour eviter perte potentielle.
  echo Si le service db etait arrete, lancez d abord DEMARRER.bat puis reessayez.
  pause
  exit /b 1
)

echo.
echo Backup OK. Arret des services...
docker compose down
if errorlevel 1 (
  echo Echec arret docker compose.
  pause
  exit /b 1
)

echo.
echo Services arretes proprement avec dernier etat sauvegarde.
pause
