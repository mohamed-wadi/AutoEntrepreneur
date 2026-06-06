@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist ".git" (
  echo ERREUR: Aucun depot Git ici.
  echo Assure-toi d'etre dans le dossier racine du projet.
  pause
  exit /b 1
)

echo Recuperation des dernieres modifications depuis GitHub...
git pull origin main
if errorlevel 1 (
  echo.
  echo ECHEC du pull depuis GitHub.
  echo Verifie ta connexion internet.
  pause
  exit /b 1
)

echo.
echo OK: Recuperation terminee avec succes.
pause
endlocal
