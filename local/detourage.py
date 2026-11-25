"""Détourage des articles du magasin, 100 % local.

1. Le modèle U²-Net compact (320 × 320) donne la silhouette grossière, en deux passes
   (photo entière puis cadrage serré sur l'objet) pour gagner en résolution.
2. GrabCut pleine résolution reclasse la bande incertaine d'après les couleurs réelles
   de l'objet et du fond : c'est ce qui récupère pieds fins, patins et barres métalliques
   que le modèle ignore, et qui rouvre les jours entre accoudoir et assise.
3. Un filtre guidé (He et al. 2010) épouse les bords de la photo pour un alpha doux.
4. Décontamination : dans les bords semi-transparents, la couleur du fond est retirée
   pour que le tissu garde sa vraie couleur sur un fond clair comme sur un fond sombre.
"""
import cv2
import numpy as np


def filtre_guide(guide, src, r, eps):
    """Filtre guidé couleur (guide BGR float 0..1, src float 0..1)."""
    mean = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
    I = guide.astype(np.float32)
    p = src.astype(np.float32)
    mI = mean(I)
    mp = mean(p)
    cov_Ip = mean(I * p[:, :, None]) - mI * mp[:, :, None]
    var = np.empty(I.shape[:2] + (3, 3), np.float32)
    for i in range(3):
        for j in range(i, 3):
            v = mean(I[:, :, i] * I[:, :, j]) - mI[:, :, i] * mI[:, :, j]
            var[:, :, i, j] = var[:, :, j, i] = v
    var += eps * np.eye(3, dtype=np.float32)
    a = np.linalg.solve(var, cov_Ip[..., None])[..., 0]
    b = mp - (a * mI).sum(2)
    return (mean(a) * I).sum(2) + mean(b)


def _prob(img, matte):
    return matte(img).astype(np.float32) / 255.0


def silhouette(img, matte):
    """Probabilité d'objet en deux passes (globale puis cadrée)."""
    H, W = img.shape[:2]
    p = _prob(img, matte)
    ys, xs = np.nonzero(p > 0.3)
    if len(ys):
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        my, mx = int(0.08 * (y1 - y0)) + 4, int(0.08 * (x1 - x0)) + 4
        y0, y1, x0, x1 = max(0, y0 - my), min(H, y1 + my), max(0, x0 - mx), min(W, x1 + mx)
        if (y1 - y0) * (x1 - x0) < 0.85 * H * W:
            q = _prob(img[y0:y1, x0:x1], matte)
            p2 = p.copy()
            p2[y0:y1, x0:x1] = np.maximum(p[y0:y1, x0:x1] * 0.5, q)
            p = p2
    return p


def _bord_sans_fond(bgr, alpha, rg):
    """Bande de bord, à la résolution réelle : un pixel qui a la couleur du fond local
    n'appartient pas à l'objet (supprime le liseré de fond). Appliqué seulement là où
    l'objet et le fond contrastent nettement, pour ne pas ronger un objet clair sur fond clair."""
    k = lambda n: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * n + 1, 2 * n + 1))
    kb = max(2, 2 * rg + 1)
    sur = (alpha > 0.5).astype(np.uint8)
    bande = (cv2.dilate(sur, k(kb)) > 0) & (cv2.erode(sur, k(kb)) == 0)
    if not bande.any():
        return alpha
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    sig = max(2.0, kb * 1.5)
    moy = lambda m: cv2.GaussianBlur(lab * m[:, :, None], (0, 0), sig) / np.maximum(cv2.GaussianBlur(m, (0, 0), sig), 1e-3)[:, :, None]
    coeur = (cv2.erode((alpha > 0.98).astype(np.uint8), k(1)) > 0).astype(np.float32)
    fond = (cv2.erode((alpha < 0.02).astype(np.uint8), k(1)) > 0).astype(np.float32)
    Fl, Bl = moy(coeur), moy(fond)
    dFB = np.sqrt(((Fl - Bl) ** 2).sum(2))
    dIB = np.sqrt(((lab - Bl) ** 2).sum(2))
    a_couleur = np.clip(dIB / np.maximum(dFB, 30) * 1.6, 0, 1)
    fiable = (cv2.GaussianBlur(coeur, (0, 0), sig) > 0.05) & (cv2.GaussianBlur(fond, (0, 0), sig) > 0.05)
    corrige = bande & (dFB > 40) & fiable
    out = alpha.copy()
    out[corrige] = np.minimum(alpha[corrige], a_couleur[corrige])
    return out


def detourer(img, matte, avec_indice=False):
    """Renvoie une image BGRA détourée (alpha doux, couleurs décontaminées) et, sur
    demande, la carte « ce pixel tranche sur le fond » utilisée par le pinceau."""
    bgr = img[:, :, :3]
    H, W = bgr.shape[:2]
    if img.shape[2] == 4 and img[:, :, 3].min() < 245 and not avec_indice:
        return img.copy()
    p = silhouette(bgr, matte)
    big = max(H, W)
    # Travail à une résolution raisonnable : réduite pour les grandes photos,
    # agrandie pour les petites (les tubes de 2 px deviennent mesurables).
    s = min(1.0, 1400 / big) if big >= 500 else min(3.0, 600 / big)
    if s != 1:
        interp = cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC
        work = cv2.resize(bgr, (round(W * s), round(H * s)), interpolation=interp)
        pw = cv2.resize(p, (work.shape[1], work.shape[0]), interpolation=cv2.INTER_LINEAR)
    else:
        work, pw = bgr, p
    h, w = work.shape[:2]
    k = lambda n: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * n + 1, 2 * n + 1))
    # Fond local estimé là où le modèle est sûr qu'il n'y a pas d'objet (lissé, « inpainté »).
    sur_fond = (pw < 0.03).astype(np.uint8)
    lab = cv2.cvtColor(work, cv2.COLOR_BGR2LAB).astype(np.float32)
    sm = max(2.0, 0.025 * max(h, w))
    num = cv2.GaussianBlur(lab * sur_fond[:, :, None], (0, 0), sm)
    den = cv2.GaussianBlur(sur_fond.astype(np.float32), (0, 0), sm)[:, :, None]
    B = num / np.maximum(den, 1e-3)
    ecart = np.sqrt(((lab - B) ** 2).sum(2))  # écart de couleur au fond local
    # Évidence d'objet : le modèle (même faiblement) ET une couleur qui tranche sur le fond.
    lisse = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
    trace = lisse(pw, 0.06, 0.3) * lisse(ecart, 10, 26)
    core = lisse(pw, 0.45, 0.75)
    hard = np.maximum(core, trace)
    # Seuls les morceaux reliés au corps de l'objet sont gardés (pas de débris de fond).
    bin_ = (hard > 0.5).astype(np.uint8)
    n, labels = cv2.connectedComponents(bin_, connectivity=8)
    if n > 1:
        keep = np.zeros(n, bool)
        keep[np.unique(labels[(pw > 0.7) & (bin_ > 0)])] = True
        keep[0] = False
        hard = hard * (keep[labels] | (bin_ == 0))
    # Alpha doux qui épouse les bords réels de la photo.
    guide = work.astype(np.float32) / 255.0
    rg = max(1, round(max(h, w) / 260))
    alpha = np.clip(filtre_guide(guide, hard, rg, 4e-4), 0, 1)
    alpha = np.maximum(alpha * (hard > 0.02), np.where(hard > 0.9, hard, 0))
    alpha = np.clip((alpha - 0.06) / 0.88, 0, 1)
    if s != 1:
        alpha = cv2.resize(alpha, (W, H), interpolation=cv2.INTER_AREA if s > 1 else cv2.INTER_LINEAR)
    alpha = _bord_sans_fond(bgr, alpha, max(1, round(big / 260)))
    # Décontamination des couleurs de bord : F = (I − (1 − α)·B) / α.
    fond = (alpha < 0.02).astype(np.uint8)
    img_f = bgr.astype(np.float32)
    if fond.any():
        sm = max(1.0, 0.01 * big)
        num = cv2.GaussianBlur(img_f * fond[:, :, None], (0, 0), sm * 3)
        den = cv2.GaussianBlur(fond.astype(np.float32), (0, 0), sm * 3)[:, :, None]
        B = num / np.maximum(den, 1e-4)
        a3 = alpha[:, :, None]
        F = (img_f - (1 - a3) * B) / np.maximum(a3, 0.15)
        bord = ((alpha > 0.02) & (alpha < 0.98))[:, :, None]
        img_f = np.where(bord, np.clip(F, 0, 255), img_f)
    out = np.dstack([np.clip(img_f, 0, 255).astype(np.uint8), np.round(alpha * 255).astype(np.uint8)])
    if not avec_indice:
        return out
    # Indice pour le pinceau « restaurer » intelligent : 1 là où la couleur tranche sur le fond.
    indice = lisse(ecart, 8, 22)
    if s != 1:
        indice = cv2.resize(indice, (W, H), interpolation=cv2.INTER_AREA if s > 1 else cv2.INTER_LINEAR)
    return out, np.round(indice * 255).astype(np.uint8)


def sur_fond(rgba, couleur_bgr):
    a = rgba[:, :, 3:4].astype(np.float32) / 255.0
    return (rgba[:, :, :3] * a + np.array(couleur_bgr, np.float32) * (1 - a)).astype(np.uint8)
