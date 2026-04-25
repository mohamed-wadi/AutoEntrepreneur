@echo off
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup-now.ps1"
if errorlevel 1 (
  echo.
  echo ECHEC DU BACKUP.
  echo Verifiez backup.env ^(DB + Google Drive/rclone^).
  pause
  exit /b 1
)

echo.
echo BACKUP TERMINE.
pause
