"""Sauvegarde vérifiée des données réelles d'Atelier Stock, sans les modifier.

Usage : runtime\\windows\\python.exe local\\outils\\sauvegarde.py [dossier de données] [dossier de destination]
Par défaut : %LOCALAPPDATA%\\AtelierStockSymphony vers %LOCALAPPDATA%\\AtelierStockSymphony_sauvegardes\\<date-heure>

- la base est ouverte en lecture seule et copiée par l'API de sauvegarde SQLite (copie cohérente) ;
- les photos sont copiées à l'identique ;
- les empreintes SHA-256 de la source sont calculées avant et après : elles doivent être identiques ;
- la copie passe PRAGMA integrity_check et son contenu est comparé table par table à l'original."""
import hashlib, os, shutil, sqlite3, sys, time
from pathlib import Path


def empreintes(dossier):
    out = {}
    for f in sorted(Path(dossier).rglob('*')):
        if f.is_file():
            out[str(f.relative_to(dossier))] = hashlib.sha256(f.read_bytes()).hexdigest()
    return out


def contenu(db):
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {t: sorted(map(tuple, db.execute(f'SELECT * FROM "{t}"').fetchall()), key=repr) for t in tables}


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else Path(os.environ['LOCALAPPDATA']) / 'AtelierStockSymphony')
    dst = Path(sys.argv[2] if len(sys.argv) > 2 else Path(os.environ['LOCALAPPDATA']) / 'AtelierStockSymphony_sauvegardes' / time.strftime('%Y-%m-%d_%H%M%S'))
    base = src / 'boutique.sqlite3'
    if not base.is_file():
        sys.exit(f'Base introuvable : {base}')
    if dst.exists():
        sys.exit(f'Destination déjà existante, rien n’est écrasé : {dst}')
    avant = empreintes(src)
    dst.mkdir(parents=True)
    ro = sqlite3.connect(f'file:{base.as_posix()}?mode=ro', uri=True)
    copie = sqlite3.connect(dst / 'boutique.sqlite3')
    ro.backup(copie)
    integ = copie.execute('PRAGMA integrity_check').fetchone()[0]
    integ_src = ro.execute('PRAGMA integrity_check').fetchone()[0]
    version = ro.execute('PRAGMA user_version').fetchone()[0]
    identique = contenu(ro) == contenu(copie)
    comptes = {t: len(r) for t, r in contenu(ro).items()}
    ro.close()
    copie.close()
    if (src / 'photos').is_dir():
        shutil.copytree(src / 'photos', dst / 'photos')
    apres = empreintes(src)
    copies = empreintes(dst)
    photos_ok = all(copies.get(k) == v for k, v in avant.items() if k.startswith('photos'))
    print('Source           :', src)
    print('Sauvegarde       :', dst)
    print('Version schéma   :', version, '(0 = base d’origine, avant les tables du studio)')
    print('Intégrité source :', integ_src, '| copie :', integ)
    print('Contenu identique table par table :', identique)
    print('Photos copiées à l’identique      :', photos_ok, f'({sum(k.startswith("photos") for k in avant)} fichiers)')
    print('Source inchangée (SHA-256 avant = après) :', avant == apres)
    print('Lignes par table :', comptes)
    ok = integ == 'ok' and integ_src == 'ok' and identique and photos_ok and avant == apres
    print('SAUVEGARDE VALIDÉE' if ok else 'SAUVEGARDE NON VALIDÉE')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
