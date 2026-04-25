# -*- mode: python ; coding: utf-8 -*-
# ──────────────────────────────────────────────────────────────────────────────
# FactureApp.spec — PyInstaller
#
# Le modele_facture.docx est embarqué DANS l'exe comme fallback.
# Mais l'app cherche D'ABORD le .docx à côté de l'exe (modifiable).
# ──────────────────────────────────────────────────────────────────────────────

a = Analysis(
    ['app_facture.py'],
    pathex=[],
    binaries=[],
    datas=[
        # Embarque le modèle dans l'exe (fallback si absent à côté de l'exe)
        ('modele_facture.docx', '.'),
    ],
    hiddenimports=['customtkinter', 'num2words'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='FactureApp',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
