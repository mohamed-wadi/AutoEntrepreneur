# Facture Gestion Hub (Local)

Ce projet est prévu pour fonctionner **en local** (frontend + backend + base de données) via **Docker Compose**.

## Prérequis

- Docker Desktop
- Git

## Lancer en local

Depuis la racine du repo :

```bash
docker compose up -d --build
```

Attends que les services soient `healthy`, puis ouvre :

- **Frontend**: `http://localhost:19509`
- **Backend API**: `http://localhost:8080/api/healthz`

## Comptes par défaut

- **admin / admin2025**
- **viewer / viewer2025**

## Arrêter

```bash
docker compose down
```

## Backups non chiffrés + Google Drive

Le projet inclut des scripts pour sauvegarder PostgreSQL en `.dump` non chiffré dans `./backups`, puis copier vers Google Drive via `rclone`.

### 1) Configurer

```bash
copy backup.env.example backup.env
```

Remplir `backup.env` (notamment `GDRIVE_FOLDER_ID`).
Pour envoyer les fichiers Excel de registres dans un dossier Drive dédié, renseigner aussi `REGISTRES_GDRIVE_FOLDER_ID`.

### 2) Backup manuel

- Double-clic `BACKUP-MANUEL.bat`

### 3) Sauvegarde automatique avant fermeture

- Pour fermer le site, utiliser **`ARRETER-ET-SAUVEGARDER.bat`** (pas `docker compose down` directement).
- Ce script fait:
  1. `pg_dump` (dernier etat)
  2. export XLSX des registres factures par `annee/trimestre` dans `backups/registres`
  3. upload des backups + dossier `Registres` vers Google Drive
  4. arrêt des conteneurs

### 4) Restaurer sur une autre machine

1. Télécharger le fichier `latest.dump` depuis Google Drive.
2. Démarrer uniquement la base:
   ```bash
   docker compose up -d db
   ```
3. Import:
   ```bash
   docker cp latest.dump facture-gestion-hub-db-1:/tmp/latest.dump
   docker compose exec -T db sh -lc "PGPASSWORD=adminpassword pg_restore -U admin -d facture_db --clean --if-exists /tmp/latest.dump"
   ```

## API

Backend Express pour la gestion des formations, factures et déclarations (routes sous `/api/...`).
