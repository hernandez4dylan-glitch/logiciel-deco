"""Régénère les images de démonstration d'Essai_photo (gomme et décor) avec le moteur local.
Lancement : runtime\\windows\\python.exe local\\tests\\essais_photo.py
Les traits de pinceau sont décrits ci-dessous en pixels de composition-originale.jpg (866 × 551)."""
import sys, time
from pathlib import Path

LOCAL = Path(__file__).resolve().parent.parent
ESSAI = LOCAL.parent / 'Essai_photo'
sys.path.insert(0, str(LOCAL))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import gomme, photo, retouche  # noqa: E402

LARGEUR = 1536  # largeur de travail du studio


def lire(nom):
    img = cv2.imdecode(np.fromfile(str(ESSAI / nom), np.uint8), cv2.IMREAD_COLOR)
    h = round(img.shape[0] * LARGEUR / img.shape[1])
    return cv2.resize(img, (LARGEUR, h), interpolation=cv2.INTER_CUBIC)


def ecrire(nom, img):
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    assert ok
    (ESSAI / nom).write_bytes(buf.tobytes())


def traits(shape, polys):
    s = LARGEUR / 866
    m = np.zeros(shape[:2], np.uint8)
    for poly in polys:
        cv2.fillPoly(m, [np.array([(round(x * s), round(y * s)) for x, y in poly])], 255)
    return m > 0


def surligner(img, zone, couleur=(40, 60, 230)):
    out = img.copy()
    out[zone] = (out[zone] * 0.45 + np.array(couleur) * 0.55).astype(np.uint8)
    return out


def main():
    img = lire('composition-originale.jpg')

    # 1. Gomme : le fauteuil de droite (structure métal comprise), peint largement.
    zone = traits(img.shape, [[(652, 310), (845, 310), (847, 486), (652, 486)]])
    t = time.time()
    efface = gomme.remplir(img, zone)
    print('gomme fauteuil', round(time.time() - t, 1), 's')
    ecrire('gomme-fauteuil-masque.jpg', surligner(img, zone))
    ecrire('gomme-fauteuil-telea.jpg', cv2.inpaint(img, zone.astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA))
    ecrire('gomme-fauteuil.jpg', efface)

    # 2. Gomme : l'horloge au-dessus des portes.
    zone = traits(img.shape, [[(752, 128), (803, 128), (803, 162), (752, 162)]])
    ecrire('gomme-horloge.jpg', gomme.remplir(img, zone))

    # 3. Décor : chaque meuble peint d'un trait, puis nouveau décor généré.
    meubles = traits(img.shape, [
        [(38, 283), (206, 283), (206, 458), (38, 458)],
        [(252, 279), (431, 279), (431, 456), (252, 456)],
        [(180, 222), (288, 222), (288, 517), (180, 517)],
        [(460, 315), (634, 315), (634, 512), (460, 512)],
        [(655, 312), (842, 312), (842, 482), (655, 482)],
        [(226, 0), (376, 0), (376, 178), (226, 178)],
        [(412, 0), (566, 0), (566, 174), (412, 174)],
    ])
    ecrire('decor-traits.jpg', surligner(img, meubles, (60, 170, 60)))
    t = time.time()
    alpha = retouche.isoler(img, meubles, photo.matte)
    print('isolement', round(time.time() - t, 1), 's')
    h, w = img.shape[:2]
    for nom, couleur, style in (('decor-sauge-parquet.jpg', '#9CAF97', 'parquet'),
                                ('decor-lin-beton.jpg', '#E3D5C0', 'beton')):
        decor = retouche.decor_genere(h, w, retouche.hex_bgr(couleur), style, 0.6)
        ecrire(nom, retouche.changer_decor(img, alpha, decor))


if __name__ == '__main__':
    main()
