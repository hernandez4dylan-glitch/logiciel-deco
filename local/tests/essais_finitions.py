"""Démonstration des surfaces et des finitions sur le rendu de référence (Essai_photo).
Les sélections sont faites comme dans le studio : quelques clics « baguette » par surface.
Lancement : runtime\\windows\\python.exe local\\tests\\essais_finitions.py"""
from pathlib import Path
import sys
import time

LOCAL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LOCAL))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import finitions as F  # noqa: E402

ESSAI = LOCAL.parent / 'Essai_photo'
MOTIFS = LOCAL.parent / 'public' / 'images' / 'motifs'


def baguette(img, clics, tol=1.0):
    H, W = img.shape[:2]
    p = np.zeros((H, W), np.uint8)
    for x, y in clics:
        cv2.circle(p, (x, y), 5, 255, -1)
    return F.selectionner(img, p > 0, np.zeros((H, W), bool), tol)


def titre(img, texte):
    out = img.copy()
    cv2.rectangle(out, (0, 0), (out.shape[1], 46), (40, 34, 30), -1)
    cv2.putText(out, texte, (14, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (245, 240, 232), 2, cv2.LINE_AA)
    return out


def main():
    img = cv2.imread(str(ESSAI / 'rendu-de-reference.jpg'))
    t = time.time()
    murs = np.maximum(baguette(img, [(1150, 420), (1545, 450), (1200, 260)]),
                      baguette(img, [(300, 350), (560, 260), (740, 420), (90, 280)]))
    plafond = baguette(img, [(700, 60), (1200, 110), (300, 120), (1450, 150)])
    porte = baguette(img, [(1330, 345), (1470, 345), (1470, 440), (1470, 560), (1305, 600), (1285, 330), (1505, 330), (1500, 500)], 1.3)
    sol = baguette(img, [(250, 960), (700, 970), (1150, 950), (1450, 930), (900, 720), (1250, 700), (100, 760)], 1.3)
    feuille, cadre = F.separer_cadre(porte, 12)
    print('Sélections :', round(time.time() - t, 1), 's')

    parquet = cv2.imread(str(MOTIFS / 'parquet-chene.jpg'))
    quad_sol = [(260, 630), (1330, 630), (2700, 1300), (-1100, 1300)]
    base = [
        {'masque': sol, 'type': 'papier', 'texture': parquet, 'quad': quad_sol, 'repetitions': 7, 'surface': 'sol'},
        {'masque': murs, 'type': 'peinture', 'couleur': '#C9B79C', 'finition': 'mat', 'surface': 'mur'},
        {'masque': plafond, 'type': 'peinture', 'couleur': '#F1EDE4', 'finition': 'mat', 'surface': 'plafond'},
        {'masque': cadre, 'type': 'peinture', 'couleur': '#EFEBE3', 'finition': 'satin', 'surface': 'cadre'},
    ]
    t = time.time()
    scene = F.appliquer(img, base + [{'masque': feuille, 'type': 'peinture', 'couleur': '#1F2A3A', 'finition': 'satin', 'surface': 'porte'}])
    print('Scène complète :', round(time.time() - t, 1), 's')
    cv2.imwrite(str(ESSAI / 'surfaces-apres.jpg'), scene, [cv2.IMWRITE_JPEG_QUALITY, 92])

    # Même porte, quatre finitions (le reste de la pièce identique).
    vues = []
    for fin, nom in (('mat', 'Mat'), ('velours', 'Velours'), ('satin', 'Satine'), ('brillant', 'Brillant')):
        r = F.appliquer(img, base + [{'masque': feuille, 'type': 'peinture', 'couleur': '#1F2A3A', 'finition': fin, 'surface': 'porte'}])
        vues.append(titre(r[260:720, 1230:1560], nom))
    cv2.imwrite(str(ESSAI / 'finitions-porte.jpg'), np.hstack(vues), [cv2.IMWRITE_JPEG_QUALITY, 92])

    # Mur vert profond : mat contre brillant, près du sol ensoleillé.
    vues = []
    for fin, nom in (('mat', 'Mur mat'), ('satin', 'Mur satine'), ('brillant', 'Mur brillant')):
        r = F.appliquer(img, [base[0], {'masque': murs, 'type': 'peinture', 'couleur': '#3E5245', 'finition': fin, 'surface': 'mur'}])
        vues.append(titre(r[200:700, 0:460], nom))
    cv2.imwrite(str(ESSAI / 'finitions-mur.jpg'), np.hstack(vues), [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('Images écrites dans', ESSAI)


if __name__ == '__main__':
    main()
