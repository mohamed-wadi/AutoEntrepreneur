@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ===================================================
echo   RESTAURATION DE LA BASE DE DONNEES (THINKPAD)
echo ===================================================
echo.

set "DUMP_SOURCE="
set "ZIP_SOURCE="

rem 1. Check in Downloads first
if exist "%USERPROFILE%\Downloads\latest.dump" (
  set "DUMP_SOURCE=%USERPROFILE%\Downloads\latest.dump"
)
if exist "%USERPROFILE%\Downloads\latest_uploads.zip" (
  set "ZIP_SOURCE=%USERPROFILE%\Downloads\latest_uploads.zip"
)

rem 2. Check in Files folder
if not defined DUMP_SOURCE (
  if exist "Files\latest.dump" (
    set "DUMP_SOURCE=Files\latest.dump"
  )
)
if not defined ZIP_SOURCE (
  if exist "Files\latest_uploads.zip" (
    set "ZIP_SOURCE=Files\latest_uploads.zip"
  )
)

rem 3. Check in project backups folder if not found
if not defined DUMP_SOURCE (
  if exist "Facture-Gestion-Hub\backups\latest.dump" (
    set "DUMP_SOURCE=Facture-Gestion-Hub\backups\latest.dump"
  )
)
if not defined ZIP_SOURCE (
  if exist "Facture-Gestion-Hub\backups\latest_uploads.zip" (
    set "ZIP_SOURCE=Facture-Gestion-Hub\backups\latest_uploads.zip"
  )
)

if not defined DUMP_SOURCE (
  echo ERREUR: Fichier 'latest.dump' introuvable.
  echo Veuillez telecharger 'latest.dump' depuis votre Google Drive (ou le copier depuis l'ASUS) 
  echo et le placer dans votre dossier 'Telechargements' (Downloads), 'Files\' ou dans 'Facture-Gestion-Hub\backups\'.
  echo.
  pause
  exit /b 1
)

echo Fichier dump trouve : %DUMP_SOURCE%
if defined ZIP_SOURCE (
  echo Fichier uploads trouve : %ZIP_SOURCE%
)
echo.

rem Make sure database is running
echo Verification de la base de donnees...
cd Facture-Gestion-Hub
docker compose up -d db
if errorlevel 1 (
  echo Echec demarrage de la base de donnees. Assurez-vous que Docker Desktop est lance.
  pause
  exit /b 1
)

echo Restauration de la base de donnees...
docker cp "%DUMP_SOURCE%" facture-gestion-hub-db-1:/tmp/restore.dump
if errorlevel 1 (
  echo Echec de la copie du fichier dump vers le conteneur.
  pause
  exit /b 1
)

docker compose exec -T db sh -lc "PGPASSWORD=adminpassword pg_restore -U admin -d facture_db --clean --if-exists /tmp/restore.dump"
if errorlevel 1 (
  echo Echec de la restauration de la base de donnees (pg_restore).
  pause
  exit /b 1
)

echo.
echo Restauration de la base de donnees effectuee avec succes !

if defined ZIP_SOURCE (
  echo.
  echo Restauration des fichiers de factures (uploads)...
  powershell -Command "Expand-Archive -Path '%ZIP_SOURCE%' -DestinationPath '.local-uploads' -Force"
  if errorlevel 1 (
    echo Avertissement: Echec de l'extraction des fichiers d'uploads.
  ) else (
    echo Fichiers d'uploads restaures avec succes !
  )
)

echo.
echo Redemarrage des services de l'application...
docker compose up -d api web
timeout /t 5 /nobreak >nul
echo.
echo OK: Restauration complete terminee !
echo Ouvrez http://localhost:19509 pour verifier vos factures.
echo.
pause
endlocal
