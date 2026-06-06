@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist ".git" (
  echo ERREUR: Aucun depot Git ici.
  echo Assure-toi d'etre dans le dossier racine du projet.
  pause
  exit /b 1
)

echo Recuperation des dernieres modifications depuis GitHub (Git Pull)...
git pull origin main
if errorlevel 1 (
  echo.
  echo ECHEC du pull depuis GitHub. Verifiez votre connexion internet.
  pause
  exit /b 1
)

echo.
echo Verification des nouvelles sauvegardes a restaurer...
if exist "Facture-Gestion-Hub\backups\latest.dump" (
  pushd Facture-Gestion-Hub
  echo Nouvelle base de donnees detectee. Demarrage du service db...
  docker compose up -d db
  
  echo Restauration de la base de donnees...
  docker compose cp backups\latest.dump db:/tmp/latest.dump
  docker compose exec -T db sh -lc "PGPASSWORD=adminpassword pg_restore -U admin -d facture_db --clean --if-exists /tmp/latest.dump"
  
  if errorlevel 1 (
    echo.
    echo AVERTISSEMENT: Echec de la restauration de la base de donnees.
    echo Assurez-vous que Docker Desktop est bien lance.
  ) else (
    echo Base de donnees restauree avec succes !
  )
  popd
)

if exist "Facture-Gestion-Hub\backups\latest_uploads.zip" (
  echo Restauration des fichiers uploades...
  if not exist "Facture-Gestion-Hub\.local-uploads" mkdir "Facture-Gestion-Hub\.local-uploads"
  powershell -Command "Expand-Archive -Path 'Facture-Gestion-Hub\backups\latest_uploads.zip' -DestinationPath 'Facture-Gestion-Hub\.local-uploads' -Force"
  echo Fichiers uploades restaures avec succes !
)

echo.
echo OK: Synchronisation terminee.
pause
endlocal
