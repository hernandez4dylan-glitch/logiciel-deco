"""Mesure l'impact de la migration sur une COPIE de la base (jamais sur l'original).

Usage : runtime\\windows\\python.exe local\\outils\\impact_migration.py <copie de boutique.sqlite3>"""
import sqlite3, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from data import migrer, VERSION  # noqa: E402


def etat(db):
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    out = {}
    for t in tables:
        cols = [r[1] for r in db.execute(f'PRAGMA table_info("{t}")')]
        out[t] = (cols, [tuple(r) for r in db.execute(f'SELECT * FROM "{t}"').fetchall()])
    return out


def comparer(avant, apres):
    """Pour chaque table existante : colonnes ajoutées, lignes ajoutées, et lignes
    d'origine modifiées ou disparues (comparées sur les colonnes d'origine)."""
    rapport = {}
    for t, (cols, lignes) in avant.items():
        cols2, lignes2 = apres.get(t, ([], []))
        if cols2[:len(cols)] != cols:
            rapport[t] = {'colonnes_retirees_ou_deplacees': True}
            continue
        anciennes = sorted(lignes, key=repr)
        coupees = [l[:len(cols)] for l in lignes2]
        restantes = list(coupees)
        perdues = 0
        for l in anciennes:
            if l in restantes:
                restantes.remove(l)
            else:
                perdues += 1
        rapport[t] = {'colonnes_ajoutees': cols2[len(cols):], 'lignes_ajoutees': len(restantes), 'lignes_modifiees_ou_perdues': perdues}
    return rapport


def main(chemin):
    db = sqlite3.connect(chemin)
    avant = etat(db)
    v0 = db.execute('PRAGMA user_version').fetchone()[0]
    v1 = migrer(db)
    apres = etat(db)
    rapport = comparer(avant, apres)
    abimees = [t for t, r in rapport.items() if r.get('colonnes_retirees_ou_deplacees') or r.get('lignes_modifiees_ou_perdues')]
    print(f'Version : {v0} -> {v1} (attendue {VERSION})')
    for t, r in rapport.items():
        if r.get('colonnes_ajoutees') or r.get('lignes_ajoutees') or t in abimees:
            print(f'  {t} : {r}')
    print('Tables existantes dont des données ont changé :', abimees or 'aucune')
    print('Nouvelles tables (lignes) :', {t: len(apres[t][1]) for t in apres if t not in avant})
    print('Intégrité après migration :', db.execute('PRAGMA integrity_check').fetchone()[0])
    print('Deuxième passage (idempotent) :', migrer(db) == v1 and etat(db) == apres)
    db.close()
    sys.exit(1 if abimees else 0)


if __name__ == '__main__':
    main(sys.argv[1])
