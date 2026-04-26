$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) {
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
}

function Get-CurrentTrimestre([datetime]$dt) {
  $m = $dt.Month
  if ($m -ge 1 -and $m -le 3) { return "T1" }
  if ($m -ge 4 -and $m -le 6) { return "T2" }
  if ($m -ge 7 -and $m -le 9) { return "T3" }
  return "T4"
}

function Get-StringHash([string]$value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($value)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLower()
  } finally {
    $sha.Dispose()
  }
}

function Test-FileReadable([string]$path) {
  try {
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $fs.Close()
    return $true
  } catch {
    return $false
  }
}

function New-UploadsArchiveBestEffort([string]$sourceRoot, [string]$destinationZip) {
  if (-not (Test-Path $sourceRoot)) {
    return @{
      Created = $false
      Included = 0
      Skipped = 0
    }
  }

  $allFiles = Get-ChildItem -Path $sourceRoot -Recurse -File -ErrorAction SilentlyContinue
  if (-not $allFiles -or $allFiles.Count -eq 0) {
    return @{
      Created = $false
      Included = 0
      Skipped = 0
    }
  }

  $stageDir = Join-Path ([System.IO.Path]::GetTempPath()) ("uploads-stage-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

  $included = 0
  $skipped = 0
  try {
    foreach ($file in $allFiles) {
      $full = $file.FullName
      if (-not (Test-FileReadable $full)) {
        $skipped++
        continue
      }
      $rel = $full.Substring($sourceRoot.Length).TrimStart('\','/')
      $target = Join-Path $stageDir $rel
      $targetDir = Split-Path -Parent $target
      if ($targetDir -and -not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
      }
      Copy-Item -Path $full -Destination $target -Force
      $included++
    }

    if ($included -eq 0) {
      return @{
        Created = $false
        Included = 0
        Skipped = $skipped
      }
    }

    if (Test-Path $destinationZip) { Remove-Item $destinationZip -Force }
    Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $destinationZip -Force
    return @{
      Created = $true
      Included = $included
      Skipped = $skipped
    }
  } finally {
    Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue
  }
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
$stateFile = Join-Path $backupDir "backup-state.json"

# Local timestamp for filenames: date + hour + minute + second
$now = Get-Date
$ts = $now.ToString("yyyy-MM-dd_HH-mm-ss")
$dayFolderName = $now.ToString("yyyy-MM-dd")
$yearFolderName = $now.ToString("yyyy")
$currentTrimestre = Get-CurrentTrimestre $now
$dumpFile = Join-Path $backupDir ("facture_db_" + $ts + ".dump")
$shaFile = $dumpFile + ".sha256"
$latestDump = Join-Path $backupDir "latest.dump"
$latestSha = Join-Path $backupDir "latest.dump.sha256"

$uploadsRoot = Join-Path $root ".local-uploads"
$uploadsZip = Join-Path $backupDir ("uploads_" + $ts + ".zip")
$latestUploadsZip = Join-Path $backupDir "latest_uploads.zip"
$registresRoot = Join-Path $backupDir "registres"
$declarationsRoot = Join-Path $backupDir "declarations"

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

function Invoke-DbJson([string]$sql) {
  $raw = & docker compose exec -T -e "PGPASSWORD=$pgPassword" db psql -U $pgUser -d $pgDb -t -A -c $sql
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to query database for change detection."
  }
  if ($null -eq $raw) { return "" }
  if ($raw -is [System.Array]) {
    return (($raw -join "`n").Trim())
  }
  return ([string]$raw).Trim()
}

# Change detection (avoid filling Drive when nothing changed)
$invoicesJson = Invoke-DbJson "SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT id, trimestre, year, numero_facture, date_formation, date_facture, cabinet, client_id, ville, prestation, montant_dh, mode_paiement, numero_paiement, date_paiement, statut, date_declaration, invoice_docx_url, created_at FROM invoices ORDER BY id) t;"
if (-not $invoicesJson) { $invoicesJson = "[]" }
$declarationsJson = Invoke-DbJson "SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT id, trimestre, year, file_url, file_name, created_at FROM declaration_documents ORDER BY id) t;"
if (-not $declarationsJson) { $declarationsJson = "[]" }

$currentInvoicesHash = Get-StringHash $invoicesJson
$currentDeclarationsHash = Get-StringHash $declarationsJson

$previousInvoicesHash = ""
$previousDeclarationsHash = ""
if (Test-Path $stateFile) {
  try {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    if ($state.invoicesHash) { $previousInvoicesHash = [string]$state.invoicesHash }
    if ($state.declarationsHash) { $previousDeclarationsHash = [string]$state.declarationsHash }
  } catch {
    Write-Step "State file unreadable, forcing one sync run."
  }
}

$invoicesChanged = ($currentInvoicesHash -ne $previousInvoicesHash)
$declarationsChanged = ($currentDeclarationsHash -ne $previousDeclarationsHash)

if (-not $invoicesChanged -and -not $declarationsChanged) {
  Write-Step "No changes in invoices/declarations: skipping backup, registres, declarations export/upload."
  exit 0
}

if ($invoicesChanged) {
  Write-Step "Invoices changed: creating PostgreSQL dump: $dumpFile"
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
    $archiveResult = New-UploadsArchiveBestEffort -sourceRoot $uploadsRoot -destinationZip $uploadsZip
    if ($archiveResult.Created) {
      Copy-Item $uploadsZip $latestUploadsZip -Force
      if ($archiveResult.Skipped -gt 0) {
        Write-Step "Uploads archived with warnings: included=$($archiveResult.Included), skipped(locked)=$($archiveResult.Skipped)"
      }
    } else {
      if ($archiveResult.Skipped -gt 0) {
        Write-Step "Uploads archive skipped: all files locked right now (skipped=$($archiveResult.Skipped)). Backup continues."
      } else {
        Write-Step "No uploaded files found. Skipping uploads archive."
      }
    }
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
} else {
  Write-Step "Invoices unchanged: skip DB dump and Registres export."
}

if ($declarationsChanged) {
  # Export declaration documents by year/trimestre from local uploaded files
  Write-Step "Declarations changed: exporting declaration documents by year/trimestre..."
  $env:DECLARATIONS_OUTPUT_DIR = $declarationsRoot
  $env:LOCAL_UPLOAD_ROOT = $uploadsRoot
  cmd /c "pnpm --filter @workspace/formation-app exec node ./scripts/export-declaration-documents.mjs"
  if ($LASTEXITCODE -ne 0) {
    throw "Declaration documents export failed."
  }
} else {
  Write-Step "Declarations unchanged: skip declaration documents export."
}

Write-Step "Applying local retention (keep latest $keepLocal)"
if ($invoicesChanged) {
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
    # NOTE:
    # We intentionally keep *one* Drive root (GDRIVE_FOLDER_ID) and organize by year:
    # <year>/Registres/T1..T4, <year>/Declarations/T1..T4, <year>/Backups_auto/T1..T4
    # Dedicated root folders (REGISTRES_GDRIVE_FOLDER_ID / DECLARATIONS_GDRIVE_FOLDER_ID)
    # are ignored to avoid legacy top-level folders like "Registres" and "Declarations".
    $regRemote = $remote
    $declRemote = $remote
    # Target layout in Drive:
    # <year>/
    #   Registres/<T1..T4>/...
    #   Declarations/<T1..T4>/...
    #   Backups_auto/<T1..T4>/...
    $remoteBackupsPath = "$remote$yearFolderName/Backups_auto/$currentTrimestre"
    Write-Step "Uploading changed data to Google Drive folder: $yearFolderName (T=$currentTrimestre)"

    $common = @("--progress")
    if ($folderId) { $common += @("--drive-root-folder-id", $folderId) }

    if ($invoicesChanged) {
      & $rcloneCmd copy $dumpFile $remoteBackupsPath @common
      if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for dump file." }
      & $rcloneCmd copy $shaFile $remoteBackupsPath @common
      if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for sha file." }

      if (Test-Path $uploadsZip) {
        & $rcloneCmd copy $uploadsZip $remoteBackupsPath @common
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
    }

    # Upload Registres for the current year only under: <year>/Registres/<T..>/
    if ($invoicesChanged -and (Test-Path $registresRoot)) {
      $localRegYear = Join-Path $registresRoot $yearFolderName
      if (Test-Path $localRegYear) {
        & $rcloneCmd copy $localRegYear "$($remote)$yearFolderName/Registres" @common
        if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for Registres folder." }
      }
    }

    # Upload Declarations for the current year only under: <year>/Declarations/<T..>/
    if ($declarationsChanged -and (Test-Path $declarationsRoot)) {
      $localDeclYear = Join-Path $declarationsRoot $yearFolderName
      if (Test-Path $localDeclYear) {
        & $rcloneCmd copy $localDeclYear "$($remote)$yearFolderName/Declarations" @common
        if ($LASTEXITCODE -ne 0) { throw "rclone upload failed for Declarations folder." }
      }
    }

    # Optional cleanup: remove legacy folders at the Drive root, if they exist.
    # After switching to <year>/..., we no longer want top-level folders like:
    # - Registres/
    # - Declarations/
    # - Backups_AutoEntrepreneur/
    try {
      $legacyRoots = @("Registres", "Declarations", "Backups_AutoEntrepreneur")
      foreach ($name in $legacyRoots) {
        $legacyPath = "$remote$name"
        $entries = & $rcloneCmd lsf $legacyPath @common
        if ($LASTEXITCODE -eq 0) {
          Write-Step "Cleaning legacy Drive folder: $name/"
          & $rcloneCmd purge $legacyPath @common
        }
      }
    } catch {
      Write-Step "Legacy Registres cleanup skipped (non-fatal)."
    }
  }
}

# Save sync state for next run
$statePayload = @{
  invoicesHash = $currentInvoicesHash
  declarationsHash = $currentDeclarationsHash
  updatedAt = (Get-Date).ToString("o")
} | ConvertTo-Json -Depth 3
$statePayload | Out-File -FilePath $stateFile -Encoding utf8

Write-Step "Backup done."
