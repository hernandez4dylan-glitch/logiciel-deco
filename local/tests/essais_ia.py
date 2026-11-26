"""Démonstration de l'IA locale sur le rendu de référence (Essai_photo/ia) : même
chaîne que le studio — analyse de la pièce, aperçus avec les finitions d'exemple du
catalogue, puis « Optimisation finale » d'un vase posé sur un tabouret. Durées affichées.
Lancement : runtime\\windows\\python.exe local\\tests\\essais_ia.py"""
from pathlib import Path
import json
import sys
import time

LOCAL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LOCAL))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import analyse  # noqa: E402
import finitions as F  # noqa: E402
import optimisation  # noqa: E402
import photo  # noqa: E402
from detourage import detourer  # noqa: E402

RACINE = LOCAL.parent
SORTIE = RACINE / 'Essai_photo' / 'ia'
MOTIFS = RACINE / 'public' / 'images' / 'motifs'


def legende(img, lignes):
    bande = np.full((26 * len(lignes) + 12, img.shape[1], 3), 245, np.uint8)
    for i, t in enumerate(lignes):
        cv2.putText(bande, t, (10, 26 + 26 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (40, 34, 30), 1, cv2.LINE_AA)
    return np.vstack([img, bande])


def main():
    SORTIE.mkdir(parents=True, exist_ok=True)
    img = cv2.imread(str(RACINE / 'Essai_photo' / 'rendu-de-reference.jpg'))
    H, W = img.shape[:2]
    t0 = time.perf_counter()
    r = analyse.analyser(img)
    t_analyse = time.perf_counter() - t0
    zones = {z['nom']: z for z in r['zones']}
    murs = [z for z in r['zones'] if z['surface'] == 'mur']
    s = 900 / max(H, W)
    petit = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    pm = lambda m: cv2.resize(m, (petit.shape[1], petit.shape[0]), interpolation=cv2.INTER_AREA)
    enduit = cv2.imread(str(MOTIFS / 'enduit-taloche.jpg'))
    papier = cv2.imread(str(MOTIFS / 'feuillage.png'))
    parquet = cv2.imread(str(MOTIFS / 'parquet-chene.jpg'))
    plafond = [{'masque': pm(zones['Plafond']['masque']), 'type': 'peinture', 'couleur': '#EFEAE1', 'surface': 'plafond'}] if 'Plafond' in zones else []
    sol = zones.get('Sol')
    props = [
        ('Beige mat (EX-PEI-BEIGE) sur les murs', [{'masque': pm(z['masque']), 'type': 'peinture', 'couleur': '#D8C7AE', 'surface': 'mur'} for z in murs]),
        ('Enduit taloche lin (EX-END-TALO)', [{'masque': pm(z['masque']), 'type': 'enduit', 'texture': enduit, 'repetitions': 1.5, 'surface': 'mur'} for z in murs]),
        ('Papier peint Feuillage sauge (EX-PAP-FEUIL)', [{'masque': pm(z['masque']), 'type': 'papier', 'texture': papier, 'repetitions': 9, 'surface': 'mur'} for z in murs]),
        ('Sauge (EX-PEI-SAUGE) + parquet chene (EX-SOL-CHENE)', [{'masque': pm(z['masque']), 'type': 'peinture', 'couleur': '#A9B5A0', 'surface': 'mur'} for z in murs]
         + ([{'masque': pm(sol['masque']), 'type': 'papier', 'texture': parquet, 'repetitions': 7, 'surface': 'sol',
              'quad': [(x * s, y * s) for x, y in [(260, 630), (1330, 630), (2700, 1300), (-1100, 1300)]]}] if sol else [])),
    ]
    vignettes, durees = [], []
    for i, (titre, zs) in enumerate(props):
        t = time.perf_counter()
        out = F.appliquer(petit, zs + plafond)
        durees.append(round(time.perf_counter() - t, 2))
        cv2.imwrite(str(SORTIE / f'hall-proposition-{i + 1}.jpg'), out, [cv2.IMWRITE_JPEG_QUALITY, 92])
        vignettes.append(legende(out, [titre, 'Plafond : Blanc casse (EX-PEI-BLANC)']))
    premier = t_analyse + durees[0]
    grille = np.vstack([np.hstack(vignettes[:2]), np.hstack(vignettes[2:])])
    cv2.imwrite(str(SORTIE / 'hall-propositions.jpg'), grille, [cv2.IMWRITE_JPEG_QUALITY, 90])

    # Composition validée : beige sur les murs (pleine résolution), vase posé sur le tabouret de gauche.
    base = F.appliquer(img, [{'masque': z['masque'], 'type': 'peinture', 'couleur': '#D8C7AE', 'surface': 'mur'} for z in murs]
                       + ([{'masque': zones['Plafond']['masque'], 'type': 'peinture', 'couleur': '#EFEAE1', 'surface': 'plafond'}] if 'Plafond' in zones else []))
    vase = cv2.imread(str(RACINE / 'public' / 'images' / 'products' / 'vase-gres.jpg'))
    cut = detourer(vase, photo.matte)
    ys, xs = np.nonzero(cut[:, :, 3] > 20)
    cut = cut[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h = 150
    w = int(cut.shape[1] * h / cut.shape[0])
    cut = cv2.resize(cut, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32)
    bx, by = 1068, 762  # plateau du tabouret de droite, devant la lampe
    x0, y0 = bx - w // 2, by - h
    alpha = np.zeros((H, W), np.float32)
    alpha[y0:by, x0:x0 + w] = cut[:, :, 3] / 255
    ombre = np.zeros((H, W), np.float32)
    cv2.ellipse(ombre, (bx, by - 2), (int(w * 0.45), 6), 0, 0, 360, 1, -1)
    ombre = cv2.GaussianBlur(ombre, (0, 0), 5) * 0.5
    comp = base.astype(np.float32) * (1 - ombre[..., None] * (1 - alpha[..., None]))
    a = alpha[y0:by, x0:x0 + w, None]
    comp[y0:by, x0:x0 + w] = comp[y0:by, x0:x0 + w] * (1 - a) + cut[:, :, :3] * a
    comp = comp.astype(np.uint8)
    t = time.perf_counter()
    opt, zon, _ = optimisation.optimiser(comp, alpha, np.clip(ombre, 0, 1))
    t_opt = time.perf_counter() - t
    cv2.imwrite(str(SORTIE / 'hall-montage.jpg'), comp, [cv2.IMWRITE_JPEG_QUALITY, 93])
    cv2.imwrite(str(SORTIE / 'hall-optimise.jpg'), opt, [cv2.IMWRITE_JPEG_QUALITY, 93])
    zoom = lambda im: cv2.resize(im[by - 230:by + 60, bx - 160:bx + 160], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    cv2.imwrite(str(SORTIE / 'hall-vase-avant-apres.jpg'), np.hstack([legende(zoom(comp), ['Montage']), legende(zoom(opt), ['Optimisation finale'])]), [cv2.IMWRITE_JPEG_QUALITY, 92])
    hors = float(np.abs(opt.astype(int) - comp.astype(int))[zon < 0.01].max())
    mesures = {'analyse_s': round(t_analyse, 1), 'detail_analyse': r['temps'], 'apercus_s': durees,
               'premier_apercu_moteur_s': round(premier, 1), 'optimisation_s': round(t_opt, 1),
               'ecart_max_hors_zones': hors, 'materiel': 'Intel Core i5-13400T, 16 Go, sans carte graphique dédiée'}
    (SORTIE / 'mesures-hall.json').write_text(json.dumps(mesures, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(mesures, ensure_ascii=False))


if __name__ == '__main__':
    main()
