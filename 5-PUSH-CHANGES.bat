@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist ".git" (
  echo ERREUR: Aucun depot Git ici.
  echo Assure-toi d'etre dans: C:\Users\moham\OneDrive\Bureau\Auto Entrepreneur
  pause
  exit /b 1
)

git add -A

git diff --cached --quiet
if %errorlevel%==0 (
  echo Rien a pousser ^(aucun changement^).
  pause
  exit /b 0
)

for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set "d=%%c-%%b-%%a"
for /f "tokens=1-3 delims=:." %%a in ("%time%") do set "t=%%a-%%b-%%c"
set "d=%d: =0%"
set "t=%t: =0%"

git commit -m "auto: push changes %d%_%t%"
if errorlevel 1 (
  echo ECHEC commit.
  pause
  exit /b 1
)

git push origin main
if errorlevel 1 (
  echo ECHEC push.
  pause
  exit /b 1
)

echo OK: Push termine.
pause
endlocal
