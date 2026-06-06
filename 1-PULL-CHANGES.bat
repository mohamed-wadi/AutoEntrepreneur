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
  echo Verifie ta connexion internet et assure-toi qu'il n'y a pas de conflit.
  pause
  exit /b 1
)

rem Check if latest.dump was updated during this pull
git diff --name-only HEAD@{1} HEAD 2>nul | findstr /i "latest.dump" >nul
if %errorlevel%==0 (
  echo.
  echo [INFO] Une nouvelle base de donnees a ete telechargee depuis GitHub.
  echo Restauration automatique en cours...
  call 7-RESTAURER-BASE.bat
) else (
  echo.
  echo [INFO] Aucun changement de base de donnees detecte.
)

echo.
echo OK: Recuperation terminee avec succes.
pause
endlocal
