"""Mesure l'impact de la migration sur une COPIE de la base (jamais sur l'original).

Usage : runtime\\windows\\python.exe local\\outils\\impact_migration.py <copie de boutique.sqlite3>"""
import sqlite3, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from data import migrer, VERSION  # noqa: E402


def etat(db):
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    schema = {r[0]: r[1] for r in db.execute("SELECT name, sql FROM sqlite_master WHERE type='table'")}
    return {t: (schema[t], sorted(map(tuple, db.execute(f'SELECT * FROM "{t}"').fetchall()), key=repr)) for t in tables}


def main(chemin):
    db = sqlite3.connect(chemin)
    avant = etat(db)
    v0 = db.execute('PRAGMA user_version').fetchone()[0]
    v1 = migrer(db)
    apres = etat(db)
    modifiees = [t for t in avant if apres.get(t) != avant[t]]
    nouvelles = {t: len(apres[t][1]) for t in apres if t not in avant}
    print(f'Version : {v0} -> {v1} (attendue {VERSION})')
    print('Tables existantes modifiées (schéma ou lignes) :', modifiees or 'aucune')
    print('Nouvelles tables (lignes ajoutées) :', nouvelles)
    print('Intégrité après migration :', db.execute('PRAGMA integrity_check').fetchone()[0])
    print('Deuxième passage (idempotent) :', migrer(db) == v1 and etat(db) == apres)
    db.close()
    sys.exit(1 if modifiees else 0)


if __name__ == '__main__':
    main(sys.argv[1])
