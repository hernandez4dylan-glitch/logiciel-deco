"""Remplacement du décor d'une photo de pièce, 100 % local (numpy + OpenCV).

Les objets peints au pinceau sont isolés (GrabCut guidé par le tracé) puis posés
sur un nouveau décor : photo importée ou décor généré (mur teinté, sol parquet,
béton ciré ou uni), avec ombres de contact et harmonisation des couleurs.
"""
import cv2
import numpy as np



def saillance_par_trait(rgb, traits, matte):
    """Probabilité « objet » (0..1) : le modèle de détourage est lancé sur un cadrage
    autour de chaque trait, comme s'il s'agissait d'une photo produit."""
    H, W = traits.shape
    out = np.zeros((H, W), np.float32)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(traits.astype(np.uint8))
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 30:
            continue
        mx, my = int(0.08 * w) + 4, int(0.08 * h) + 4
        x0, y0, x1, y1 = max(0, x - mx), max(0, y - my), min(W, x + w + mx), min(H, y + h + my)
        m = matte(rgb[y0:y1, x0:x1]).astype(np.float32) / 255.0
        out[y0:y1, x0:x1] = np.maximum(out[y0:y1, x0:x1], m * (lab[y0:y1, x0:x1] == i))
    return out


def isoler(rgb, traits, matte=None):
    """Masque alpha (float 0..1) des objets peints. Le pinceau délimite la zone ; si un
    modèle de détourage `matte` est fourni, il propose la silhouette, puis GrabCut
    tranche avec les couleurs du fond situé hors du tracé."""
    H, W = traits.shape
    sal = saillance_par_trait(rgb, traits, matte) if matte is not None else None
    scale = min(1.0, 900 / max(H, W))
    small = cv2.resize(rgb, (round(W * scale), round(H * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else rgb
    size = (small.shape[1], small.shape[0])
    t = cv2.resize(traits.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST) > 0
    marge = max(3, round(0.015 * max(small.shape[:2])))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * marge + 1, 2 * marge + 1))
    zone = cv2.dilate(t.astype(np.uint8), k) > 0
    gc = np.full(t.shape, cv2.GC_BGD, np.uint8)
    gc[zone] = cv2.GC_PR_BGD
    gc[t] = cv2.GC_PR_FGD
    if sal is not None:
        ss = cv2.resize(sal, size, interpolation=cv2.INTER_AREA)
        gc[t & (ss > 0.85)] = cv2.GC_FGD
    if not (gc == cv2.GC_FGD).any() and not (gc == cv2.GC_PR_FGD).any():
        gc[t] = cv2.GC_PR_FGD
    try:
        bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
        cv2.grabCut(small, gc, None, bgd, fgd, 5, cv2.GC_INIT_WITH_MASK)
        fg = ((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)).astype(np.uint8)
    except cv2.error:
        fg = t.astype(np.uint8)
    # On ne garde que les morceaux reliés au tracé, et on bouche les petits trous.
    n, lab = cv2.connectedComponents(fg)
    keep = np.zeros(n, bool)
    keep[np.unique(lab[t & (fg > 0)])] = True
    keep[0] = False
    fg = keep[lab].astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    alpha = cv2.resize(fg.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
    s = max(1.0, 0.8 / scale)
    alpha = np.clip((cv2.GaussianBlur(alpha, (0, 0), s) - 0.5) * 1.6 + 0.5, 0, 1)
    if sal is None:
        return alpha
    # Le modèle donne des contours fins et doux (pieds métal, cordons) ; GrabCut complète
    # seulement là où le modèle voit au moins une trace d'objet (pieds, socles sombres).
    # (Essayé : un second passage du modèle sur toute la photo récupère des pieds de
    # tabouret mais ajoute aussi des morceaux de mur ou de porte ; abandonné.)
    trace = cv2.dilate(sal, np.ones((5, 5), np.uint8)) > 0.12
    return np.maximum(np.clip(sal * 1.2, 0, 1), alpha * trace) * traits_zone(traits)


def traits_zone(traits):
    return (cv2.dilate(traits.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0).astype(np.float32)


def _bruit(h, w, rng, echelle):
    small = rng.standard_normal((max(2, h // echelle), max(2, w // echelle))).astype(np.float32)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)


def decor_genere(h, w, couleur_bgr, style, horizon, seed=3):
    """Décor neutre : mur teinté avec lumière douce et sol (parquet, béton ciré ou uni).
    Calculé en double résolution puis réduit, pour des joints sans crénelage."""
    big = _decor(2 * h, 2 * w, couleur_bgr, style, horizon, seed)
    return cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA)


def _decor(h, w, couleur_bgr, style, horizon, seed):
    rng = np.random.default_rng(seed)
    yh = int(np.clip(horizon, 0.3, 0.9) * h)
    wall = np.array(couleur_bgr, np.float32)
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    xx = np.linspace(-1, 1, w, dtype=np.float32)[None, :]
    light = 1.06 - 0.10 * yy - 0.07 * xx ** 2
    img = np.empty((h, w, 3), np.float32)
    img[:] = wall
    img *= light[:, :, None]
    img += _bruit(h, w, rng, 3)[:, :, None] * 2.2  # grain d'enduit

    fh = h - yh
    if fh > 0:
        y = np.arange(fh, dtype=np.float32)[:, None] + 1
        depth = (fh * 0.35) / (y + fh * 0.12)  # plus loin en haut du sol
        u = (np.arange(w, dtype=np.float32)[None, :] - w / 2) * depth / w * 6
        if style == 'parquet':
            # Lames parallèles au mur, de plus en plus serrées vers le fond (perspective),
            # joints de bout décalés d'une rangée à l'autre, teinte variable par lame.
            base = np.array([96, 146, 190], np.float32)  # chêne clair (BGR)
            v = depth * 26.0                     # profondeur : une rangée par unité
            rang = np.floor(v)
            decal = (np.sin(rang * 78.233) * 43758.5453) % 1.0
            x = u * 3.7 + decal                   # longueur de lame : une unité (≈ 7 × la largeur)
            lame = np.floor(x)
            ton = (np.sin(rang * 12.9898 + lame * 4.1414) * 43758.5453) % 1.0
            fil = _bruit(fh, w, rng, 3)
            veines = np.sin(x * 23 + v * 2 + fil * 2.5)
            floor = base[None, None, :] * (0.84 + 0.2 * ton[:, :, None] + 0.025 * veines[:, :, None])
            # Joints fins (largeur en pixels à peu près constante).
            dv = np.abs(np.diff(v, axis=0, prepend=v[:1] - 1e-3)) + 1e-6
            joint_r = ((v % 1.0) < dv * 1.2)
            dx = np.abs(np.diff(x, axis=1, prepend=x[:, :1] - 1e-3)) + 1e-6
            joint_b = ((x % 1.0) < dx * 1.2)
            floor[joint_r | joint_b] *= 0.78
            # Reflet doux de la lumière sur le vernis.
            floor *= (1 + 0.06 * np.exp(-((np.arange(w)[None, :] - w * 0.35) / (w * 0.25)) ** 2))[:, :, None]
        elif style == 'beton':
            base = np.array([168, 172, 174], np.float32)
            floor = base[None, None, :] * (1 + 0.05 * _bruit(fh, w, rng, 40)[:, :, None] + 0.025 * _bruit(fh, w, rng, 6)[:, :, None])
        else:
            floor = (wall * 0.82)[None, None, :] * (1 + 0.02 * _bruit(fh, w, rng, 10)[:, :, None]) + np.zeros((fh, w, 1), np.float32)
        fy = np.linspace(0, 1, fh, dtype=np.float32)[:, None, None]
        floor = floor * (0.84 + 0.22 * fy)  # le sol s'éclaire vers l'avant
        img[yh:] = floor
        plinthe = max(2, h // 90)
        img[max(0, yh - plinthe):yh] = wall * 0.96 + 10
        img[yh:yh + 2] *= 0.8
    # Lumière rasante douce et léger vignetage.
    vign = 1 - 0.18 * (xx ** 2 + (yy * 2 - 1) ** 2 * 0.6)
    img *= vign[:, :, None]
    return np.clip(img, 0, 255).astype(np.uint8)


def couvrir(img, h, w):
    """Redimensionne en remplissant tout le cadre (comme background-size: cover)."""
    ih, iw = img.shape[:2]
    s = max(w / iw, h / ih)
    nw, nh = max(w, round(iw * s)), max(h, round(ih * s))
    r = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    y, x = (nh - h) // 2, (nw - w) // 2
    return r[y:y + h, x:x + w]


def changer_decor(rgb, alpha, decor):
    """Pose les objets (alpha) sur `decor` avec ombres de contact et harmonisation."""
    h, w = alpha.shape
    a = alpha[:, :, None].astype(np.float32)
    fond = decor.astype(np.float32)
    # Ombres : occlusion ambiante large + ombre de contact serrée, décalées vers le bas.
    big = max(3.0, 0.025 * h)
    small = max(1.5, 0.006 * h)
    m = alpha.astype(np.float32)
    shift = lambda img, d: np.vstack([np.zeros((d, w), np.float32), img[:h - d]]) if d > 0 else img
    occl = cv2.GaussianBlur(shift(m, int(big * 1.2)), (0, 0), big)
    # Ombre de contact : bas des objets (pieds, socles) étalé à plat sur le sol.
    up = np.vstack([m[3:], np.zeros((3, w), np.float32)])
    pieds = np.clip(m - up, 0, 1)
    pieds[: int(h * 0.5)] = 0  # les suspensions n'ont pas d'ombre de contact au sol
    contact = cv2.GaussianBlur(pieds, (0, 0), sigmaX=max(2.0, 0.012 * w), sigmaY=max(1.5, 0.005 * h))
    contact = contact / (contact.max() + 1e-6)
    ombre = np.clip(0.28 * occl + 0.62 * contact, 0, 0.7)[:, :, None]
    fond = fond * (1 - ombre)

    obj = rgb.astype(np.float32)
    sel = alpha > 0.5
    if sel.any():
        # Harmonisation : on rapproche légèrement luminosité et dominante des objets de celles du décor.
        lab_o = cv2.cvtColor(rgb, cv2.COLOR_BGR2LAB).astype(np.float32)
        lab_d = cv2.cvtColor(decor, cv2.COLOR_BGR2LAB).astype(np.float32)
        mo, md = lab_o[sel].mean(0), lab_d.reshape(-1, 3).mean(0)
        lab_o[:, :, 0] += 0.15 * (md[0] - mo[0])
        lab_o[:, :, 1:] += 0.10 * (md[1:] - mo[1:])
        obj = cv2.cvtColor(np.clip(lab_o, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32)
    # Lumière enveloppante : le décor flou déborde légèrement sur les bords des objets.
    bord = np.clip(m - cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))), 0, 1)[:, :, None]
    flou = cv2.GaussianBlur(decor.astype(np.float32), (0, 0), 6)
    obj = obj * (1 - 0.35 * bord) + flou * 0.35 * bord
    out = obj * a + fond * (1 - a)
    return np.clip(out, 0, 255).astype(np.uint8)


def hex_bgr(color):
    return [int(color[i:i + 2], 16) for i in (5, 3, 1)]

