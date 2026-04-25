$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) {
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
}

function Load-EnvFile([string]$path) {
  if (-not (Test-Path $path)) { return }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    [Environment]::SetEnvironmentVariable($key, $val, "Process")
  }
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Load-EnvFile (Join-Path $root "backup.env")

$backupEnabled = [Environment]::GetEnvironmentVariable("BACKUP_ENABLED", "Process")
if ($backupEnabled -and $backupEnabled.ToLower() -eq "false") {
  Write-Step "BACKUP_ENABLED=false, backup skipped."
  exit 0
}

$pgUser = [Environment]::GetEnvironmentVariable("POSTGRES_USER", "Process")
if (-not $pgUser) { $pgUser = "admin" }
$pgPassword = [Environment]::GetEnvironmentVariable("POSTGRES_PASSWORD", "Process")
if (-not $pgPassword) { $pgPassword = "adminpassword" }
$pgDb = [Environment]::GetEnvironmentVariable("POSTGRES_DB", "Process")
if (-not $pgDb) { $pgDb = "facture_db" }
$keepLocal = [Environment]::GetEnvironmentVariable("BACKUP_KEEP_LOCAL", "Process")
if (-not $keepLocal) { $keepLocal = "30" }

$backupDir = Join-Path $root "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

# Local timestamp for filenames: date + hour + minute + second
$now = Get-Date
$ts = $now.ToString("yyyy-MM-dd_HH-mm-ss")
$dayFolderName = $now.ToString("yyyy-MM-dd")
$dumpFile = Join-Path $backupDir ("facture_db_" + $ts + ".dump")
$shaFile = $dumpFile + ".sha256"
$latestDump = Join-Path $backupDir "latest.dump"
$latestSha = Join-Path $backupDir "latest.dump.sha256"

$uploadsRoot = Join-Path $root ".local-uploads"
$uploadsZip = Join-Path $backupDir ("uploads_" + $ts + ".zip")
$latestUploadsZip = Join-Path $backupDir "latest_uploads.zip"
$registresRoot = Join-Path $backupDir "registres"

# Ensure DB service is running before dump
Write-Step "Ensuring db service is running..."
cmd /c "docker compose up -d db"
if ($LASTEXITCODE -ne 0) {
  throw "Unable to start db service."
}

# Wait until PostgreSQL accepts connections
$maxWaitSec = 60
$ready = $false
for ($i = 0; $i -lt $maxWaitSec; $i++) {
  cmd /c "docker compose exec -T db sh -lc ""PGPASSWORD=$pgPassword pg_isready -U $pgUser -d $pgDb"" >nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 1
}
if (-not $ready) {
  throw "Database is not ready after ${maxWaitSec}s."
}

Write-Step "Creating PostgreSQL dump: $dumpFile"
$dumpCmd = "PGPASSWORD=$pgPassword pg_dump -U $pgUser -d $pgDb -Fc"
cmd /c "docker compose exec -T db sh -lc ""$dumpCmd"" > ""$dumpFile"""
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed."
}

$hash = (Get-FileHash -Algorithm SHA256 -Path $dumpFile).Hash.ToLower()
"$hash  $(Split-Path -Leaf $dumpFile)" | Out-File -FilePath $shaFile -Encoding ascii
Copy-Item $dumpFile $latestDump -Force
"$hash  latest.dump" | Out-File -FilePath $latestSha -Encoding ascii

if (Test-Path $uploadsRoot) {
  Write-Step "Archiving uploaded files: $uploadsZip"
  if (Test-Path $uploadsZip) { Remove-Item $uploadsZip -Force }
  Compress-Archive -Path (Join-Path $uploadsRoot "*") -DestinationPath $uploadsZip -Force
  Copy-Item $uploadsZip $latestUploadsZip -Force
} else {
  Write-Step "No .local-uploads folder found. Skipping uploads archive."
}

# Export invoices as XLSX per year/quarter (Registres)
Write-Step "Exporting Registres XLSX by year/trimestre..."
$env:EXPORT_STAMP = $ts
$env:REGISTRES_OUTPUT_DIR = (Join-Path $backupDir "registres")
$exportUser = [Environment]::GetEnvironmentVariable("EXPORT_AUTH_USERNAME", "Process")
$exportPass = [Environment]::GetEnvironmentVariable("EXPORT_AUTH_PASSWORD", "Process")
if ($exportUser) { $env:EXPORT_AUTH_USERNAME = $exportUser }
if ($exportPass) { $env:EXPORT_AUTH_PASSWORD = $exportPass }
cmd /c "pnpm --filter @workspace/formation-app exec node ./scripts/export-invoices-xlsx.mjs"
if ($LASTEXITCODE -ne 0) {
  throw "Registres XLSX export failed."
}

Write-Step "Applying local retention (keep latest $keepLocal)"
$allBackups = Get-ChildItem -Path $backupDir -Filter "facture_db_*.dump" | Sort-Object LastWriteTime -Descending
$maxKeep = 30
if ([int]::TryParse($keepLocal, [ref]$maxKeep) -eq $false) { $maxKeep = 30 }
if ($maxKeep -lt 1) { $maxKeep = 1 }
$toDelete = $allBackups | Select-Object -Skip $maxKeep
foreach ($file in $toDelete) {
  $suffix = ($file.Name -replace "^facture_db_", "" -replace "\.dump$", "")
  Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
  Remove-Item ($file.FullName + ".sha256") -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $backupDir ("uploads_" + $suffix + ".zip")) -Force -ErrorAction SilentlyContinue
}

$upload = [Environment]::GetEnvironmentVariable("GDRIVE_UPLOAD", "Process")
if ($upload -and $upload.ToLower() -eq "true") {
  $rcloneLookup = Get-Command rclone -ErrorAction SilentlyContinue
  $rcloneCmd = $null
  if ($rcloneLookup) {
    $rcloneCmd = $rcloneLookup.Source
  }
  if (-not $rcloneCmd) {
    $wingetRclone = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\rclone.exe"
    if (Test-Path $wingetRclone) {
      $rcloneCmd = $wingetRclone
    }
  }
  if (-not $rcloneCmd) {
    Write-Step "rclone not installed: Google Drive upload skipped."
  } else {
    $remote = [Environment]::GetEnvironmentVariable("GDRIVE_REMOTE", "Process")
    if (-not $remote) { $remote = "gdrive:" }
    $folderId = [Environment]::GetEnvironmentVariable("GDRIVE_FOLDER_ID", "Process")
    $regRemote = [Environment]::GetEnvironmentVariable("REGISTRES_GDRIVE_REMOTE", "Process")
    if (-not $regRemote) { $regRemote = $remote }
    $regFolderId = [Environment]::GetEnvironmentVariable("REGISTRES_GDRIVE_FOLDER_ID", "Process")
    $remoteDayPath = "$remote$dayFolderName"
    Write-Step "Uploading backup to Google Drive folder: $dayFolderName"

    $common = @("--progress")
    if ($folderId) { $common += @("--drive-root-folder-id", $folderId) }

    & $rcloneCmd copy $dumpFile $remoteDayPath @common
    if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for dump file." }
    & $rcloneCmd copy $shaFile $remoteDayPath @common
    if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for sha file." }

    if (Test-Path $uploadsZip) {
      & $rcloneCmd copy $uploadsZip $remoteDayPath @common
      if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for uploads zip." }
    }

    # Keep "latest" at root for quick restore.
    & $rcloneCmd copy $latestDump $remote @common
    if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for latest dump." }
    & $rcloneCmd copy $latestSha $remote @common
    if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for latest sha file." }
    if (Test-Path $latestUploadsZip) {
      & $rcloneCmd copy $latestUploadsZip $remote @common
      if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for latest uploads zip." }
    }

    # Upload Registres/<year>/<trimestre>/...xlsx for this run
    if (Test-Path $registresRoot) {
      if ($regFolderId) {
        $regCommon = @("--progress", "--drive-root-folder-id", $regFolderId)
        & $rcloneCmd copy $registresRoot $regRemote @regCommon
      } else {
        & $rcloneCmd copy $registresRoot "$($remote)Registres" @common
      }
      if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for Registres folder." }
    }
  }
}

Write-Step "Backup done."
