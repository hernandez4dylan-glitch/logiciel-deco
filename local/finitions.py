"""Murs : sélection, peinture, papier peint et enduit, 100 % local (NumPy + OpenCV).

Principe de rendu : la photo est décomposée en « couleur du mur » × « éclairage ».
L'éclairage (rapport entre la luminance de chaque pixel et la luminance typique du
mur) est conservé tel quel ; seule la couleur de base change. Ainsi le pan de mur
près de la fenêtre reste plus lumineux que le fond, les ombres des meubles restent
en place et l'on n'obtient pas un aplat.
"""
import cv2
import numpy as np
from detourage import filtre_guide


# ---------------------------------------------------------------- couleurs

def srgb_lin(x):
    x = x.astype(np.float32) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin_srgb(x):
    x = np.clip(x, 0, 1)
    y = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.clip(y * 255.0 + 0.5, 0, 255).astype(np.uint8)


def luminance(lin):
    return lin[..., 2] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 0] * 0.0722  # BGR


def hex_lin(color):
    bgr = np.array([[[int(color[i:i + 2], 16) for i in (5, 3, 1)]]], np.uint8)
    return srgb_lin(bgr)[0, 0]


# ---------------------------------------------------------------- sélection

def affiner(img, masque, rayon=None):
    """Recale les bords d'un masque sur les contours réels de la photo (filtre guidé)."""
    h, w = masque.shape
    s = min(1.0, 1600 / max(h, w))
    small = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else img
    m = cv2.resize(masque.astype(np.float32), (small.shape[1], small.shape[0]), interpolation=cv2.INTER_AREA) if s < 1 else masque.astype(np.float32)
    r = rayon or max(2, round(max(small.shape[:2]) / 400))
    a = filtre_guide(small.astype(np.float32) / 255.0, m, r, 2e-4)
    a = np.clip((a - 0.5) * 1.6 + 0.5, 0, 1)
    if s < 1:
        a = cv2.resize(a, (w, h), interpolation=cv2.INTER_LINEAR)
    return a


def selectionner(img, plus, moins, tolerance=1.0):
    """Sélection d'un mur à partir de clics/traits « mur » (plus) et « pas le mur » (moins).
    1. Croissance de région depuis les clics : même teinte (a, b en Lab) que le mur
       cliqué, luminosité libre dans une large plage (lumière de fenêtre, ombres),
       et arrêt sur les contours nets (arête mur/plafond, cadres, plinthes).
    2. GrabCut affine la frontière dans une bande étroite autour de la région.
    3. Les bords sont recalés sur la photo (filtre guidé) ; « pas le mur » reste exclu."""
    H, W = plus.shape
    s = min(1.0, 900 / max(H, W))
    size = (max(8, round(W * s)), max(8, round(H * s)))
    small = cv2.resize(img, size, interpolation=cv2.INTER_AREA)
    sz = lambda m: cv2.resize(m.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST) > 0
    p, n = sz(plus), sz(moins)
    if not p.any():
        raise ValueError('Cliquez ou peignez d’abord sur le mur')
    lab = cv2.cvtColor(cv2.GaussianBlur(small, (0, 0), 1.0), cv2.COLOR_BGR2LAB).astype(np.float32)
    ab, L = lab[:, :, 1:] - 128.0, lab[:, :, 0]  # OpenCV décale a et b de 128 en 8 bits
    gx = cv2.Sobel(L, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(L, cv2.CV_32F, 0, 1)
    contour = np.hypot(gx, gy) > 48 / max(tolerance, 0.3)
    region = p.copy()
    # Chaque clic (ou trait) a sa propre couleur de référence : un clic maladroit sur
    # un meuble ne fait pas exploser la tolérance des autres.
    nseed, seeds = cv2.connectedComponents(p.astype(np.uint8))
    for i in range(1, nseed):
        g = seeds == i
        coeur = cv2.erode(g.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        g = coeur if coeur.sum() >= 4 else g
        mu = np.median(ab[g], axis=0)
        Lm = float(np.median(L[g]))
        ok_L = (L > Lm * (1 - 0.55 * tolerance)) & (L < Lm * (1 + 0.8 * tolerance) + 10)
        chroma = np.hypot(ab[:, :, 0], ab[:, :, 1])
        c0 = float(np.hypot(*mu))
        if c0 < 10:
            # Mur neutre (blanc, gris) : on compare la teinte absolue, avec tolérance.
            ok_c = np.sqrt(((ab - mu) ** 2).sum(2)) < 9 * tolerance
        else:
            # Mur coloré : même teinte (angle) ; la saturation suit la lumière.
            ang = np.degrees(np.arctan2(ab[:, :, 1], ab[:, :, 0]))
            d_ang = np.abs((ang - np.degrees(np.arctan2(mu[1], mu[0])) + 180) % 360 - 180)
            ratio = chroma / c0
            ok_c = (d_ang < 10 * tolerance) & (ratio > 1 - 0.45 * tolerance) & (ratio < 1 + 0.6 * tolerance)
        ok = ok_c & ok_L & ~contour & ~n
        nlab, labels = cv2.connectedComponents(ok.astype(np.uint8), connectivity=4)
        keep = np.zeros(nlab, bool)
        keep[np.unique(labels[g & ok])] = True
        keep[0] = False
        region |= keep[labels]
    region = cv2.morphologyEx(region.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0
    # GrabCut dans une bande autour de la région (ne peut pas « couler » plus loin).
    r = max(3, round(max(size) / 150))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    gc = np.full(region.shape, cv2.GC_BGD, np.uint8)
    gc[cv2.dilate(region.astype(np.uint8), k) > 0] = cv2.GC_PR_BGD
    gc[region] = cv2.GC_PR_FGD
    gc[cv2.erode(region.astype(np.uint8), k) > 0] = cv2.GC_FGD
    gc[p] = cv2.GC_FGD
    gc[n] = cv2.GC_BGD
    fg = region.astype(np.uint8)
    if (gc == cv2.GC_BGD).any():
        try:
            bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
            cv2.grabCut(small, gc, None, bgd, fgd, 3, cv2.GC_INIT_WITH_MASK)
            fg = ((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)).astype(np.uint8)
        except cv2.error:
            pass
    full = cv2.resize(fg.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
    a = affiner(img, full)
    a[cv2.resize(n.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST) > 0] = 0
    return a


# ---------------------------------------------------------------- éclairage

def eclairage(img, masque):
    """Facteur d'éclairage du mur : luminance / luminance typique (médiane) du mur."""
    lin = srgb_lin(img)
    Y = luminance(lin)
    sel = masque > 0.5
    ref = float(np.median(Y[sel])) if sel.any() else float(np.median(Y))
    ref = max(ref, 1e-4)
    return Y / ref, lin, ref


# ---------------------------------------------------------------- textures

def _tuile(tex, mode):
    if mode == 'miroir':  # enduit : raccords invisibles
        top = np.hstack([tex, tex[:, ::-1]])
        return np.vstack([top, top[::-1]])
    return tex


def texture_plan(tex, quad, shape, repetitions, mode='repeter'):
    """Plaque la texture en perspective : `quad` = 4 coins (x, y) en pixels de l'image,
    dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche, correspondant à un
    rectangle du mur. `repetitions` = nombre de motifs sur la largeur du rectangle."""
    H, W = shape
    q = np.array(quad, np.float32)
    largeur = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    hauteur = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    t = _tuile(tex, mode)
    th, tw = t.shape[:2]
    if mode == 'miroir':
        tw, th = tw // 2, th // 2  # une « répétition » = une tuile d'origine
    # Résolution du plan : assez fine pour la zone la plus proche.
    px = int(np.clip(max(largeur, hauteur) * 1.5, 256, 4096))
    rep_u = max(0.05, float(repetitions))
    rep_v = rep_u * (hauteur / max(largeur, 1)) * (tw / max(th, 1))
    # Le plan couvre [-1, 2] × [-1, 2] du rectangle pour remplir tout le mur visible.
    span = 3
    pw = int(px * span)
    ph = int(px * span * hauteur / max(largeur, 1))
    ph = int(np.clip(ph, 64, 12000))
    pw = int(np.clip(pw, 64, 12000))
    motif_w = pw / (rep_u * span)
    scale = motif_w / tw
    tt = cv2.resize(t, (max(1, round(t.shape[1] * scale)), max(1, round(t.shape[0] * scale))),
                    interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    ny, nx = ph // tt.shape[0] + 2, pw // tt.shape[1] + 2
    plan = np.tile(tt, (ny, nx, 1))[:ph, :pw]
    src = np.array([[pw / span, ph / span], [2 * pw / span, ph / span],
                    [2 * pw / span, 2 * ph / span], [pw / span, 2 * ph / span]], np.float32)
    M = cv2.getPerspectiveTransform(src, q)
    return cv2.warpPerspective(plan, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def enduit_genere(couleur_lin, shape, seed=11):
    """Enduit / béton ciré sans photo d'échantillon : nuages doux et fines taches."""
    H, W = shape
    rng = np.random.default_rng(seed)
    def bruit(ech):
        b = rng.standard_normal((max(2, H // ech), max(2, W // ech))).astype(np.float32)
        return cv2.resize(b, (W, H), interpolation=cv2.INTER_CUBIC)
    v = 0.07 * bruit(60) + 0.04 * bruit(18) + 0.015 * bruit(3)
    return np.clip(couleur_lin[None, None, :] * (1 + v[:, :, None]), 0, 1)


# ---------------------------------------------------------------- application

def etendre_bord(img, m):
    """Les pixels du bord qui ont encore la teinte de l'ancien mur (mélange mur/plafond,
    mur/huisserie) sont entièrement repeints : supprime le liseré de l'ancienne couleur."""
    sel = m > 0.9
    if sel.sum() < 50:
        return m
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    ab = lab[:, :, 1:] - 128.0
    mu = np.median(ab[sel], axis=0)
    if np.hypot(*mu) < 8:
        return m  # mur d'origine neutre : rien à craindre
    bande = (cv2.dilate((m > 0.3).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0) & (m < 0.95)
    d = np.sqrt(((ab - mu) ** 2).sum(2))
    proche = np.clip(1 - (d - 8) / 22, 0, 1)  # 1 = même teinte que le mur
    out = m.copy()
    out[bande] = np.maximum(m[bande], proche[bande])
    return out


def appliquer(img, zones):
    """Applique les finitions de chaque zone ; renvoie l'image BGR finie.
    zone = {'masque': float HxW, 'type': 'peinture'|'papier'|'enduit',
            'couleur': '#rrggbb', 'texture': BGR ou None, 'quad': 4 coins ou None,
            'repetitions': float, 'intensite_lumiere': float (1 = lumière d'origine)}"""
    out = srgb_lin(img)
    H, W = img.shape[:2]
    for z in zones:
        m = np.clip(z['masque'].astype(np.float32), 0, 1)
        if m.max() <= 0.01:
            continue
        m = etendre_bord(img, m)
        S, _, _ = eclairage(img, m)
        # Lumière conservée ; un léger lissage retire le grain de l'ancien enduit
        # sans toucher aux grandes variations (fenêtre, ombres).
        S_lisse = cv2.bilateralFilter(S.astype(np.float32), 9, 0.08, 6)
        k = float(z.get('intensite_lumiere', 1.0))
        S = np.clip(1 + (S_lisse - 1) * k, 0, 4)[:, :, None]
        kind = z['type']
        if kind == 'peinture':
            base = hex_lin(z['couleur'])[None, None, :]
            albedo = np.broadcast_to(base, (H, W, 3))
        else:
            tex = z.get('texture')
            if tex is None:
                if kind != 'enduit':
                    raise ValueError('Importez le motif du papier peint')
                albedo = enduit_genere(hex_lin(z.get('couleur') or '#BDB8B1'), (H, W))
            else:
                quad = z.get('quad')
                if quad is None:
                    ys, xs = np.nonzero(m > 0.5)
                    quad = [(xs.min(), ys.min()), (xs.max(), ys.min()), (xs.max(), ys.max()), (xs.min(), ys.max())]
                mode = 'miroir' if kind == 'enduit' else 'repeter'
                plaque = texture_plan(tex[:, :, :3], quad, (H, W), z.get('repetitions') or 4, mode)
                albedo = srgb_lin(plaque)
                # Le papier est imprimé à sa couleur moyenne : on garde ses contrastes,
                # l'éclairage de la pièce s'applique par-dessus.
        nouveau = albedo * S
        a = m[:, :, None]
        out = out * (1 - a) + nouveau * a
    return lin_srgb(out)
