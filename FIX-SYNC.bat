@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ===================================================
echo   RESOLUTION DE LA COLLISION DE SYNCHRONISATION
echo ===================================================
echo.

if not exist ".git" (
  echo ERREUR: Aucun depot Git detecte ici.
  pause
  exit /b 1
)

echo [1/4] Annulation du commit local non envoye...
git reset HEAD~1

echo [2/4] Nettoyage des scripts temporaires locaux...
git checkout -- 5-PUSH-CHANGES.bat >nul 2>&1
if exist "6-PULL-CHANGES.bat" del "6-PULL-CHANGES.bat"
if exist "SETUP-ASUS.bat" del "SETUP-ASUS.bat"

echo [3/4] Masquage des raccourcis locaux (*.lnk et desktop.ini)...
git update-index --assume-unchanged "01-Generateur Des Factures.lnk" >nul 2>&1
git update-index --assume-unchanged "1-DEMARRER.lnk" >nul 2>&1
git update-index --assume-unchanged "2-HEBERGER.lnk" >nul 2>&1
git update-index --assume-unchanged "3-ARRETER-ET-SAUVEGARDER.lnk" >nul 2>&1
git update-index --assume-unchanged "4-BACKUP-MANUEL.lnk" >nul 2>&1
git update-index --assume-unchanged "Factures.lnk" >nul 2>&1
git update-index --assume-unchanged "Facture-Gestion-Hub/DEMARRER.bat - Shortcut.lnk" >nul 2>&1
git update-index --assume-unchanged "desktop.ini" >nul 2>&1

echo [4/4] Recuperation des scripts propres depuis GitHub...
git pull origin main

echo.
echo ===================================================
echo   SUCCES : La synchronisation est reparee !
echo ===================================================
echo.
echo - Le commit en conflit a ete annule proprement.
echo - La derniere version officielle de 5-PUSH-CHANGES.bat et 6-PULL-CHANGES.bat a ete recuperee.
echo.
echo Vous pouvez maintenant supprimer ce fichier FIX-SYNC.bat.
echo.
pause
endlocal
