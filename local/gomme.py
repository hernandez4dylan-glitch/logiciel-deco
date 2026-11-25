"""Gomme : effacement d'objet avec remplissage par la photo elle-même (100 % local).

Méthode : remplissage par exemplaires de Criminisi, Pérez & Toyama (2004).
Les patchs du bord du trou où arrivent des contours (joint de carrelage, bas de
porte, plinthe) sont bouchés en premier ; chaque patch est copié depuis l'endroit
de la photo qui lui ressemble le plus. Le calcul se fait à résolution réduite, puis
les décalages trouvés servent à recopier les pixels pleine résolution : le grain et
la netteté de la photo sont conservés, au lieu du flou d'une diffusion (Telea).
"""
import cv2
import numpy as np

PATCH = 4      # rayon du patch à la résolution de travail (patch 9 × 9)
CIBLE = 150    # plus grande dimension d'une zone à la résolution de travail
RAYON = 60     # rayon de recherche (résolution de travail)


def sources_valides(interdit, p):
    """Centres de patchs entièrement connus et entièrement dans l'image."""
    h, w = interdit.shape
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2 * p + 1, 2 * p + 1))
    bad = cv2.dilate(interdit.astype(np.uint8), k) > 0
    bad[:p, :] = True
    bad[h - p:, :] = True
    bad[:, :p] = True
    bad[:, w - p:] = True
    return ~bad


def criminisi(img, hole, p=PATCH, interdit=None, seed=7):
    """Remplit `hole` dans `img` (float32 HxWx3). `interdit` : pixels inconnus qui ne
    doivent servir ni de source ni de référence (autres zones à effacer).
    Renvoie (image remplie, décalages source − cible par pixel)."""
    rng = np.random.default_rng(seed)
    h, w = hole.shape
    interdit = np.zeros_like(hole) if interdit is None else interdit & ~hole
    filled = ~hole
    conf = (filled & ~interdit).astype(np.float32)
    off = np.zeros((h, w, 2), np.int32)
    valid = sources_valides(hole | interdit, p)
    big = np.float32(1e20)
    ks = 2 * p + 1
    work = img.copy()
    gray = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    gx, gy = cv2.Sobel(gray, cv2.CV_32F, 1, 0) / 4, cv2.Sobel(gray, cv2.CV_32F, 0, 1) / 4
    sure = (cv2.erode((filled & ~interdit).astype(np.uint8), None) > 0).astype(np.float32)
    # Tenseur de structure : direction des contours qui arrivent sur le bord du trou.
    tens = [cv2.boxFilter(v * sure, -1, (ks, ks), normalize=False) for v in (gx * gx, gx * gy, gy * gy)]
    cnt = cv2.boxFilter(sure, -1, (ks, ks), normalize=False) + 1e-3
    jxx, jxy, jyy = (t / cnt for t in tens)
    pad = lambda a: cv2.copyMakeBorder(a, p, p, p, p, cv2.BORDER_CONSTANT, value=0)
    remaining = int(hole.sum())
    while remaining > 0:
        front = (cv2.dilate(filled.astype(np.uint8), None) > 0) & ~filled
        fy, fx = np.nonzero(front)
        if not len(fy):
            break
        c = cv2.boxFilter(conf, -1, (ks, ks), normalize=True, borderType=cv2.BORDER_CONSTANT)
        fm = cv2.GaussianBlur(filled.astype(np.float32), (0, 0), 1.5)
        nx = cv2.Sobel(fm, cv2.CV_32F, 1, 0)[fy, fx]
        ny = cv2.Sobel(fm, cv2.CV_32F, 0, 1)[fy, fx]
        nn = np.hypot(nx, ny) + 1e-6
        nx, ny = nx / nn, ny / nn
        # Énergie de l'isophote (perpendiculaire au gradient) le long de la normale.
        iso = jyy[fy, fx] * nx * nx - 2 * jxy[fy, fx] * nx * ny + jxx[fy, fx] * ny * ny
        prio = c[fy, fx] * (np.sqrt(np.maximum(iso, 0)) / 64.0 + 0.05)
        i = int(np.argmax(prio + rng.random(len(prio)) * 1e-6))
        cy, cx = int(fy[i]), int(fx[i])
        wp = pad(work)[cy:cy + ks, cx:cx + ks]
        mp = pad((filled & ~interdit).astype(np.float32))[cy:cy + ks, cx:cx + ks]
        m3 = np.repeat(mp[:, :, None], 3, 2)
        R = max(RAYON, 3 * ks)
        sy0, sy1 = max(0, cy - R), min(h, cy + R + 1)
        sx0, sx1 = max(0, cx - R), min(w, cx + R + 1)
        res = None
        if sy1 - sy0 >= ks and sx1 - sx0 >= ks:
            res = cv2.matchTemplate(work[sy0:sy1, sx0:sx1], wp, cv2.TM_SQDIFF, mask=m3)
            ok = valid[sy0 + p:sy1 - p, sx0 + p:sx1 - p][:res.shape[0], :res.shape[1]]
            res = np.where(ok & np.isfinite(res), res, big)
        if res is None or res.min() >= big:
            # Rien de valable à proximité : on cherche dans toute l'image.
            res = cv2.matchTemplate(work, wp, cv2.TM_SQDIFF, mask=m3)
            ok = valid[p:h - p, p:w - p][:res.shape[0], :res.shape[1]]
            res = np.where(ok & np.isfinite(res), res, big)
            sy0 = sx0 = 0
            if res.min() >= big:
                break
        # Légère préférence pour les sources proches de la cible.
        ry = np.arange(res.shape[0])[:, None] + sy0 + p - cy
        rx = np.arange(res.shape[1])[None, :] + sx0 + p - cx
        res = np.where(res < big, res * (1 + 0.25 * np.sqrt(ry ** 2 + rx ** 2) / R), big)
        by, bx = np.unravel_index(int(np.argmin(res)), res.shape)
        best = float(res[by, bx])
        sy, sx = sy0 + by + p, sx0 + bx + p
        ty0, ty1 = max(0, cy - p), min(h, cy + p + 1)
        tx0, tx1 = max(0, cx - p), min(w, cx + p + 1)
        # Cohérence : on reprend si possible le décalage des voisins déjà remplis,
        # ce qui prolonge un même morceau de photo au lieu d'un patchwork.
        known = filled[ty0:ty1, tx0:tx1] & hole[ty0:ty1, tx0:tx1]
        if known.any():
            for dy, dx in np.unique(off[ty0:ty1, tx0:tx1][known], axis=0)[:12]:
                qy, qx = cy + int(dy) - sy0 - p, cx + int(dx) - sx0 - p
                if 0 <= qy < res.shape[0] and 0 <= qx < res.shape[1] and res[qy, qx] <= best * 1.25 + 50:
                    sy, sx = cy + int(dy), cx + int(dx)
                    break
        todo = ~filled[ty0:ty1, tx0:tx1]
        dy, dx = sy - cy, sx - cx
        work[ty0:ty1, tx0:tx1][todo] = work[ty0 + dy:ty1 + dy, tx0 + dx:tx1 + dx][todo]
        off[ty0:ty1, tx0:tx1][todo] = (dy, dx)
        conf[ty0:ty1, tx0:tx1][todo] = c[cy, cx]
        filled[ty0:ty1, tx0:tx1] |= todo
        remaining -= int(todo.sum())
    return work, off


def _zone(rgb, hole, interdit, seed):
    """Efface une zone connexe ; renvoie l'image modifiée."""
    H, W = hole.shape
    ys, xs = np.nonzero(hole)
    by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    ext = max(by1 - by0, bx1 - bx0)
    marge = int(max(40, ext))
    y0, y1 = max(0, by0 - marge), min(H, by1 + marge)
    x0, x1 = max(0, bx0 - marge), min(W, bx1 + marge)
    crop = rgb[y0:y1, x0:x1]
    trou = hole[y0:y1, x0:x1]
    autre = interdit[y0:y1, x0:x1]
    s = min(1.0, CIBLE / ext)
    ch, cw = trou.shape
    sw, sh = max(12, round(cw * s)), max(12, round(ch * s))
    small = cv2.resize(crop, (sw, sh), interpolation=cv2.INTER_AREA).astype(np.float32)
    shrink = lambda m: cv2.resize(m.astype(np.uint8), (sw, sh), interpolation=cv2.INTER_AREA) > 0
    strou = cv2.dilate(shrink(trou).astype(np.uint8), None) > 0
    sautre = shrink(autre)
    if not sources_valides(strou | sautre, PATCH).any():
        return cv2.inpaint(rgb, hole.astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
    work, off = criminisi(small, strou, PATCH, sautre, seed)
    # Pleine résolution : chaque pixel du trou reprend le pixel source correspondant.
    ty, tx = np.nonzero(trou)
    o = off[np.minimum((ty * s).astype(int), sh - 1), np.minimum((tx * s).astype(int), sw - 1)] / s
    src_y = np.round(ty + o[:, 0]).astype(int)
    src_x = np.round(tx + o[:, 1]).astype(int)
    good = (src_y >= 0) & (src_y < ch) & (src_x >= 0) & (src_x < cw)
    good[good] = ~(trou | autre)[src_y[good], src_x[good]]
    up = cv2.resize(work, (cw, ch), interpolation=cv2.INTER_CUBIC)
    full = crop.astype(np.float32).copy()
    full[ty, tx] = up[ty, tx]
    full[ty[good], tx[good]] = crop[src_y[good], src_x[good]]
    # Les écarts de lumière entre morceaux copiés sont lissés (basses fréquences seulement).
    k = max(3.0, 2 / s)
    lowfix = cv2.GaussianBlur(up, (0, 0), k) - cv2.GaussianBlur(full, (0, 0), k)
    full[trou] += lowfix[trou] * 0.6
    a = cv2.GaussianBlur(cv2.dilate(trou.astype(np.uint8), None).astype(np.float32), (5, 5), 0)[:, :, None]
    a = np.maximum(a, trou[:, :, None])
    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(crop * (1 - a) + full * a, 0, 255).astype(np.uint8)
    return out


def remplir(rgb, hole, seed=7):
    """Efface les zones `hole` (bool HxW) de `rgb` (uint8 HxWx3, BGR).
    Chaque zone séparée est traitée à sa propre échelle ; les zones pas encore
    traitées ne servent jamais de source."""
    hole = hole.astype(bool)
    if not hole.any():
        return rgb.copy()
    # Les zones très proches sont regroupées pour éviter les raccords entre elles.
    proche = cv2.dilate(hole.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    n, lab = cv2.connectedComponents(proche)
    zones = sorted(range(1, n), key=lambda i: int(((lab == i) & hole).sum()))
    out = rgb.copy()
    reste = hole.copy()
    for i in zones:
        z = (lab == i) & hole
        if not z.any():
            continue
        reste &= ~z
        out = _zone(out, z, reste, seed)
    return out
