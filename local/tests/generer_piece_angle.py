"""Deuxième pièce d'essai (Essai_photo/piece-angle.jpg) : deux murs qui se rejoignent
en angle, une fenêtre et sa lumière, un tableau, des plinthes, un parquet, et deux
articles du catalogue détourés posés au premier plan. Dessinée ici (aucune image tierce
hormis les photos d'articles du logiciel).
Lancement : runtime\\windows\\python.exe local\\tests\\generer_piece_angle.py"""
from pathlib import Path
import sys

LOCAL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LOCAL))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import photo  # noqa: E402
from detourage import detourer  # noqa: E402
from finitions import texture_plan  # noqa: E402

W, H = 1600, 1067
rng = np.random.default_rng(5)


def bruit(shape, s):
    b = rng.standard_normal((max(2, shape[0] // s), max(2, shape[1] // s))).astype(np.float32)
    return cv2.resize(b, (shape[1], shape[0]), interpolation=cv2.INTER_CUBIC)


def remplir(img, poly, couleur, lumiere=None):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.int32(poly)], 255)
    c = np.array(couleur, np.float32)[None, None, :] * (lumiere[..., None] if lumiere is not None else 1)
    img[m > 0] = c[m > 0] if lumiere is not None else c[0, 0]
    return m > 0


def main():
    img = np.zeros((H, W, 3), np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # Géométrie : angle de la pièce en x = 620, ligne de plafond, ligne de sol.
    ax, haut_a, bas_a = 620, 250, 760
    haut_g, bas_g = 60, 980      # bord gauche de l'image (mur gauche fuyant vers nous)
    haut_d, bas_d = 170, 860     # bord droit
    gauche = [(0, haut_g), (ax, haut_a), (ax, bas_a), (0, bas_g)]
    droite = [(ax, haut_a), (W, haut_d), (W, bas_d), (ax, bas_a)]
    plafond = [(0, 0), (W, 0), (W, haut_d), (ax, haut_a), (0, haut_g)]
    sol = [(0, bas_g), (ax, bas_a), (W, bas_d), (W, H), (0, H)]
    # Lumière de la fenêtre (à gauche) : décroît vers la droite, plus douce en haut.
    lum = np.clip(1.25 - 0.55 * xx / W + 0.06 * bruit((H, W), 300), 0.45, 1.4)
    remplir(img, plafond, (236, 238, 240), np.clip(lum * 0.95 + 0.05, 0.6, 1.1))
    remplir(img, gauche, (196, 214, 226), lum * 1.05)    # blanc chaud, côté fenêtre
    remplir(img, droite, (168, 182, 196), lum * 0.92)    # beige grisé, angle plus sombre
    ombre_angle = np.exp(-np.abs(xx - ax) / 60)[..., None] * 0.12
    img *= 1 - ombre_angle * ((yy > haut_a - 80) & (yy < bas_a + 80))[..., None]
    parquet = cv2.imread(str(LOCAL.parent / 'public' / 'images' / 'motifs' / 'parquet-chene.jpg'))
    sol_m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(sol_m, [np.int32(sol)], 255)
    p = texture_plan(parquet, [(150, bas_a), (1400, bas_a), (2600, H + 300), (-1300, H + 300)], (H, W), 6, 'repeter').astype(np.float32)
    img[sol_m > 0] = (p * np.clip(lum, 0.6, 1.2)[..., None])[sol_m > 0]
    # Plinthes blanches.
    for (x0, y0), (x1, y1) in (((0, bas_g), (ax, bas_a)), ((ax, bas_a), (W, bas_d))):
        e = 22
        cv2.fillPoly(img, [np.int32([(x0, y0 - e * (1.4 if x0 == 0 else 1)), (x1, y1 - e), (x1, y1), (x0, y0)])], (236, 238, 240))
    # Fenêtre sur le mur gauche (cadre blanc, vitrage clair).
    fen = [(140, 230), (430, 300), (430, 640), (140, 700)]
    cv2.fillPoly(img, [np.int32(fen)], (238, 240, 242))
    vit = [(165, 250), (405, 312), (405, 625), (165, 680)]
    cv2.fillPoly(img, [np.int32(vit)], (250, 236, 214))
    cv2.line(img, (285, 282), (285, 655), (238, 240, 242), 10)
    # Tableau sur le mur droit.
    cv2.fillPoly(img, [np.int32([(980, 330), (1240, 315), (1240, 520), (980, 525)])], (40, 52, 64))
    cv2.fillPoly(img, [np.int32([(996, 345), (1224, 332), (1224, 505), (996, 510)])], (110, 150, 170))
    cv2.circle(img, (1110, 420), 50, (60, 120, 190), -1)
    img = np.clip(img * (1 + 0.012 * bruit((H, W), 3)[..., None]), 0, 255)
    # Articles du catalogue au premier plan (détourés par le logiciel).
    for nom, hauteur, base in (('fauteuil-bouclette.jpg', 520, (1180, 1040)), ('table-chene.jpg', 300, (520, 1010))):
        a = cv2.imread(str(LOCAL.parent / 'public' / 'images' / 'products' / nom))
        cut = detourer(a, photo.matte)
        ys, xs = np.nonzero(cut[:, :, 3] > 20)
        cut = cut[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        w = int(cut.shape[1] * hauteur / cut.shape[0])
        cut = cv2.resize(cut, (w, hauteur), interpolation=cv2.INTER_AREA).astype(np.float32)
        x0, y0 = base[0] - w // 2, base[1] - hauteur
        x1, y1 = min(W, x0 + w), min(H, y0 + hauteur)
        c = cut[: y1 - y0, : x1 - x0]
        om = np.zeros((H, W), np.float32)
        cv2.ellipse(om, (base[0], base[1] - 6), (int(w * 0.48), 18), 0, 0, 360, 1, -1)
        img *= 1 - 0.45 * cv2.GaussianBlur(om, (0, 0), 9)[..., None]
        al = c[:, :, 3:4] / 255
        img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - al) + c[:, :, :3] * al
    cv2.imwrite(str(LOCAL.parent / 'Essai_photo' / 'piece-angle.jpg'), np.clip(img, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 93])
    print('Essai_photo/piece-angle.jpg écrit')


if __name__ == '__main__':
    main()
