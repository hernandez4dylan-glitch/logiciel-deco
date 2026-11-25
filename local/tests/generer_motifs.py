"""Génère les motifs d'exemple livrés avec le logiciel (public/images/motifs).
Dessinés ici, sans image tierce. Lancement : runtime\\windows\\python.exe local\\tests\\generer_motifs.py"""
from pathlib import Path
import cv2
import numpy as np

OUT = Path(__file__).resolve().parents[2] / 'public' / 'images' / 'motifs'
OUT.mkdir(parents=True, exist_ok=True)


def feuillage(n=480):
    """Feuillage sauge sur fond crème, raccord droit (une répétition)."""
    img = np.full((n, n, 3), (214, 229, 236), np.uint8)  # crème (BGR)
    rng = np.random.default_rng(4)
    big = np.zeros((n * 3, n * 3, 3), np.uint8)
    big[:] = img[0, 0]
    for _ in range(26):
        cx, cy = rng.uniform(0, n, 2)
        ang = rng.uniform(0, 180)
        L = rng.uniform(n * 0.09, n * 0.16)
        col = [(120, 150, 125), (96, 128, 104), (150, 172, 152)][rng.integers(0, 3)]
        for dx in (-n, 0, n):
            for dy in (-n, 0, n):
                c = (int(cx + dx + n), int(cy + dy + n))
                cv2.ellipse(big, c, (int(L), int(L * 0.34)), ang, 0, 360, col, -1, cv2.LINE_AA)
                e = np.deg2rad(ang)
                p2 = (int(c[0] + np.cos(e) * L), int(c[1] + np.sin(e) * L))
                p1 = (int(c[0] - np.cos(e) * L * 1.15), int(c[1] - np.sin(e) * L * 1.15))
                cv2.line(big, p1, p2, (84, 110, 92), 2, cv2.LINE_AA)
    tile = big[n:2 * n, n:2 * n]
    grain = rng.normal(0, 3, tile.shape)
    return np.clip(tile + grain, 0, 255).astype(np.uint8)


def enduit(n=600):
    """Échantillon d'enduit taloché beige clair (raccord en miroir dans le moteur)."""
    rng = np.random.default_rng(9)
    def bruit(e):
        b = rng.standard_normal((max(2, n // e), max(2, n // e))).astype(np.float32)
        return cv2.resize(b, (n, n), interpolation=cv2.INTER_CUBIC)
    v = 0.06 * bruit(80) + 0.04 * bruit(25) + 0.025 * bruit(6) + 0.012 * bruit(2)
    base = np.array([176, 192, 205], np.float32)
    return np.clip(base * (1 + v[:, :, None]), 0, 255).astype(np.uint8)


if __name__ == '__main__':
    cv2.imwrite(str(OUT / 'feuillage.png'), feuillage())
    cv2.imwrite(str(OUT / 'enduit-taloche.jpg'), enduit(), [cv2.IMWRITE_JPEG_QUALITY, 90])
    print('Motifs écrits dans', OUT)
