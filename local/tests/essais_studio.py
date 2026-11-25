"""Prépare les images de démonstration du studio dans Essai_photo.

Usage : runtime\\windows\\python.exe local\\tests\\essais_studio.py <dossier photos> <détourage corrigé.png>
  <dossier photos>       dossier « photos » des données où les visuels ont été exportés
                         depuis le studio (demo-variante-a.png, -b, -c)
  <détourage corrigé>    fichier PNG enregistré sur la fiche article après retouche au pinceau

Le détourage automatique est recalculé avec le moteur du logiciel (local/detourage.py)."""
import sys
from pathlib import Path

LOCAL = Path(__file__).resolve().parent.parent
ESSAI = LOCAL.parent / 'Essai_photo'
sys.path.insert(0, str(LOCAL))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import detourage, photo  # noqa: E402

CLAIR, SOMBRE = (223, 231, 236), (34, 33, 36)  # BGR


def ecrire(nom, img, q=90):
    ext = Path(nom).suffix.lower()
    ok, buf = cv2.imencode(ext, img, [cv2.IMWRITE_JPEG_QUALITY, q] if ext == '.jpg' else [])
    assert ok
    (ESSAI / nom).write_bytes(buf.tobytes())


def agrandi(img, f=3):
    return cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)


def main(photos, corrige):
    photos = Path(photos)
    orig = cv2.imread(str(ESSAI / 'fauteuil-original.png'), cv2.IMREAD_COLOR)
    # Ancien moteur : U²-Net en un passage, alpha agrandi tel quel.
    a_old = photo.matte(orig)[:, :, None] / 255.0
    auto = detourage.detourer(orig, photo.matte)
    fix = cv2.imread(str(corrige), cv2.IMREAD_UNCHANGED)
    assert fix is not None and fix.shape[2] == 4, 'détourage corrigé illisible'
    cv2.imwrite(str(ESSAI / 'fauteuil-v2-auto.png'), auto)
    cv2.imwrite(str(ESSAI / 'fauteuil-v2-corrige.png'), fix)
    for nom, fond in (('clair', CLAIR), ('sombre', SOMBRE)):
        ancien = (orig * a_old + np.array(fond) * (1 - a_old)).astype(np.uint8)
        ecrire(f'fauteuil-v2-{nom}-ancien.png', agrandi(ancien))
        ecrire(f'fauteuil-v2-{nom}-auto.png', agrandi(detourage.sur_fond(auto, fond)))
        ecrire(f'fauteuil-v2-{nom}-corrige.png', agrandi(detourage.sur_fond(fix, fond)))

    # Mur recoloré : rendu d'origine et variantes exportées par le studio.
    ref = cv2.imread(str(ESSAI / 'rendu-de-reference.jpg'))
    variantes = {k: cv2.imread(str(photos / f'demo-variante-{k}.png')) for k in 'abc'}
    for k, img in variantes.items():
        assert img is not None and img.shape == ref.shape, f'variante {k} manquante'
        ecrire(f'studio-variante-{k}.jpg', img, 92)
    a = variantes['a']
    # Zooms sur les contours : jonction plafond, huisserie de porte, horloge, bas du mur.
    zooms = [(195, 265, 1180, 1330), (280, 350, 1240, 1320), (240, 300, 1360, 1460), (560, 660, 1450, 1573)]
    lignes = []
    for y0, y1, x0, x1 in zooms:
        h = 210
        c1 = cv2.resize(ref[y0:y1, x0:x1], (round((x1 - x0) * h / (y1 - y0)), h), interpolation=cv2.INTER_NEAREST)
        c2 = cv2.resize(a[y0:y1, x0:x1], (c1.shape[1], h), interpolation=cv2.INTER_NEAREST)
        sep = np.full((h, 8, 3), 255, np.uint8)
        lignes.append(np.hstack([c1, sep, c2]))
    w = max(l.shape[1] for l in lignes)
    lignes = [np.hstack([l, np.full((l.shape[0], w - l.shape[1], 3), 255, np.uint8)]) for l in lignes]
    ecrire('mur-contours-zoom.png', np.vstack([np.vstack([l, np.full((8, w, 3), 255, np.uint8)]) for l in lignes]))
    # Lumière conservée : bande du mur, côté fenêtre (gauche) puis fond (droite).
    bande = (slice(330, 520), slice(1130, 1573))
    ecrire('mur-lumiere-avant.jpg', ref[bande], 92)
    ecrire('mur-lumiere-apres.jpg', a[bande], 92)
    lum = lambda im: cv2.cvtColor(im, cv2.COLOR_BGR2LAB)[:, :, 0].astype(float)
    # Deux bandes de mur uniquement : entre les deux portes (près de la lumière) et à droite de la porte.
    g = lambda im: (lum(im)[340:520, 1135:1255].mean(), lum(im)[340:520, 1522:1570].mean())
    print('Luminance mur (côté fenêtre, fond) avant :', [round(v) for v in g(ref)], 'après :', [round(v) for v in g(a)])
    print('Images écrites dans', ESSAI)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
