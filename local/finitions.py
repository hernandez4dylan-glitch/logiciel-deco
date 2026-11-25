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


def _boucher_trous(region, ab, L, interdit, tolerance):
    """Ajoute les trous enclos dans la sélection qui ont la couleur de la surface :
    l'intérieur d'une lettre collée (« A », « D »), un reflet isolé. Un trou d'une autre
    couleur (interrupteur, cadre, tableau) reste exclu, comme ce qui est protégé."""
    if region.sum() < 50:
        return region
    Hs, Ws = region.shape
    ref_ab = np.median(ab[region], axis=0)
    ref_L = float(np.median(L[region]))
    # « Entouré de près » : fermeture morphologique de la sélection (≈3 % de l'image),
    # car une lettre collée près du bord ouvre le trou vers l'extérieur.
    r = max(3, round(max(Hs, Ws) * 0.03))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    enclos = (cv2.morphologyEx(region.astype(np.uint8), cv2.MORPH_CLOSE, k) > 0) & ~region & ~interdit
    if not enclos.any():
        return region
    # Pixel par pixel : dans un trou « lettre + son intérieur », seul l'intérieur a la
    # couleur de la surface ; même plage de lumière que la croissance de région (une
    # tache de soleil entre les brindilles d'un bouquet reste le mur).
    meme = (np.sqrt(((ab - ref_ab) ** 2).sum(2)) < 8 * tolerance) & \
        (L > ref_L * (1 - 0.55 * tolerance)) & (L < ref_L * (1 + 0.8 * tolerance) + 10)
    cand = (enclos & meme).astype(np.uint8)
    nc, lc, sc, _ = cv2.connectedComponentsWithStats(cand, connectivity=4)
    garde = (sc[:, 4] >= 3) & (sc[:, 4] <= 3 * r * r)  # petits trous seulement
    garde[0] = False
    return region | garde[lc]


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
    avant = region
    region = _boucher_trous(region, ab, L, n, tolerance)
    trous = region & ~avant  # intérieurs de lettres, brindilles : gardés sûrs
    region = cv2.morphologyEx(region.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0
    # GrabCut dans une bande autour de la région (ne peut pas « couler » plus loin).
    r = max(3, round(max(size) / 150))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    gc = np.full(region.shape, cv2.GC_BGD, np.uint8)
    gc[cv2.dilate(region.astype(np.uint8), k) > 0] = cv2.GC_PR_BGD
    gc[region] = cv2.GC_PR_FGD
    gc[cv2.erode(region.astype(np.uint8), k) > 0] = cv2.GC_FGD
    gc[p] = cv2.GC_FGD
    gc[trous & ~n] = cv2.GC_FGD
    gc[n] = cv2.GC_BGD
    fg = region.astype(np.uint8)
    if (gc == cv2.GC_BGD).any():
        try:
            bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
            cv2.setRNGSeed(0)  # même clic, même sélection
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


# ---------------------------------------------------------------- modèle physique
#
# Une photo de mur = couleur de la peinture (albédo) × lumière qui l'éclaire.
# On estime la lumière À PARTIR DE LA PHOTO, en couleur (soleil chaud, ombre froide),
# séparée en deux échelles :
#   - l'éclairage (grandes variations : fenêtre, coins, ombres des meubles),
#   - le micro-relief (grain de l'enduit, moulures d'une porte, joints).
# La nouvelle couleur reçoit exactement cette lumière, puis la finition ajoute son
# reflet : nul en mat, doux et diffus en velours, plus net et plus « laiteux » en satiné.

FINITIONS = ('mat', 'velours', 'satin', 'brillant')

# spec : force du reflet de la lumière ; lobe : largeur du reflet (fraction de l'image) ;
# voile : reflet diffus de la pièce (aspect laiteux) ; relief : grain conservé ;
# profondeur : contraste/saturation des peintures brillantes (teinte plus « riche ») ;
# miroir : force du reflet de la scène (sol, meubles) ; net : flou de ce reflet.
BRILLANCE = {
    'mat':      dict(spec=0.00, lobe=0.000, voile=0.000, relief=1.00, profondeur=1.00, miroir=0.00, net=0.000),
    'velours':  dict(spec=0.10, lobe=0.060, voile=0.020, relief=0.90, profondeur=1.03, miroir=0.025, net=0.030),
    'satin':    dict(spec=0.26, lobe=0.022, voile=0.045, relief=0.75, profondeur=1.07, miroir=0.055, net=0.010),
    'brillant': dict(spec=0.48, lobe=0.008, voile=0.070, relief=0.60, profondeur=1.12, miroir=0.10, net=0.002),
}

# Finition par défaut selon la surface (usage courant des peintres).
FINITION_SURFACE = {'mur': 'mat', 'plafond': 'mat', 'porte': 'satin', 'cadre': 'satin', 'sol': 'satin', 'autre': 'mat'}
# Lissé du support : une porte ou une boiserie laquée est lisse et reflète nettement ;
# un grand mur ou un plafond enduit, même en satiné, renvoie un reflet bien plus diffus.
LISSE_SURFACE = {'mur': 0.45, 'plafond': 0.35, 'porte': 1.0, 'cadre': 1.0, 'sol': 0.8, 'autre': 1.0}


def _flou(x, sigma):
    return cv2.GaussianBlur(x, (0, 0), max(0.5, float(sigma)))


def decomposer_lumiere(lin, m):
    """Lumière d'une surface déduite de la photo : renvoie (couleur de la lumière RGB,
    éclairage lissé, micro-relief, albédo d'origine estimé)."""
    H, W = m.shape
    sel = m > 0.6
    if sel.sum() < 30:
        sel = m > 0.2
    Y = luminance(lin)
    ys = Y[sel]
    lo, hi = np.percentile(ys, [30, 80])
    coeur = sel & (Y >= lo) & (Y <= hi)
    if coeur.sum() < 20:
        coeur = sel
    A = np.median(lin[coeur], axis=0)  # couleur d'origine de la surface (linéaire)
    Yl = luminance(lin)
    Ya = float(luminance(A[None, None, :])[0, 0])
    Iy = np.maximum(Yl / max(Ya, 1e-4), 1e-4)  # lumière reçue (intensité)
    taille = max(H, W)
    w = (m > 0.5).astype(np.float32)

    def dans_surface(x, sigma):
        """Moyenne locale calculée seulement avec les pixels de la surface : les murs
        voisins (porte blanche, plafond) ne « débordent » pas dans la lumière estimée."""
        num = _flou(x * w, sigma)
        den = _flou(w, sigma)
        return num / np.maximum(den, 1e-4), den

    # Couleur de la lumière (chaude au soleil, froide à l'ombre) : très lissée, et
    # seulement si l'ancienne peinture était assez neutre pour la mesurer (sur un mur
    # orange, le canal bleu ne contient presque que du bruit).
    fiab = float(np.clip(A.min() / max(A.max(), 1e-4) / 0.45, 0, 1)) * 0.8
    C = np.ones((H, W, 3), np.float32)
    if fiab > 0.05:
        ratio = lin / np.maximum(A, 1e-4)[None, None, :]
        ratio = ratio / np.maximum(luminance(ratio), 1e-4)[:, :, None]
        lisse = np.dstack([dans_surface(ratio[:, :, c].astype(np.float32), 0.02 * taille)[0] for c in range(3)])
        C = (1 + (np.clip(lisse, 0.7, 1.4) - 1) * fiab).astype(np.float32)
    # Éclairage : version lissée qui respecte les arêtes, calculée sur la surface seule.
    logI = np.log(Iy).astype(np.float32)
    moy, den = dans_surface(logI, 0.015 * taille)
    rempli = np.where(w > 0, logI, np.where(den > 0.02, moy, float(np.median(logI[w > 0])) if w.any() else 0.0)).astype(np.float32)
    s = min(1.0, 900 / taille)
    small = (lambda a: cv2.resize(a, (round(W * s), round(H * s)), interpolation=cv2.INTER_AREA)) if s < 1 else (lambda a: a)
    guide = cv2.cvtColor(np.clip(lin_srgb(lin), 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    g3 = small(np.dstack([guide] * 3))
    r = max(3, round(max(g3.shape[:2]) / 90))
    base_log = filtre_guide(g3, small(rempli), r, 4e-3)
    if s < 1:
        base_log = cv2.resize(base_log, (W, H), interpolation=cv2.INTER_LINEAR)
    base = np.exp(base_log)
    detail = np.clip(Iy / np.maximum(base, 1e-4), 0.5, 2.0)
    # Le relief n'a de sens qu'à l'intérieur : au bord (pixels mêlés), on le neutralise.
    interieur = cv2.erode((m > 0.9).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
    interieur = _flou(interieur, 1.0)
    detail = 1 + (detail - 1) * interieur
    return C, base.astype(np.float32), detail.astype(np.float32), A


def ligne_de_base(m):
    """Ligne où une surface verticale rejoint le sol, une valeur par colonne : droite
    ajustée sur les colonnes dont le bas est le plus bas (un meuble posé devant
    remonte le bas de la sélection sans déplacer le pied du mur)."""
    H, W = m.shape
    sel = m > 0.5
    cols = np.nonzero(sel.any(0))[0]
    if len(cols) < 2:
        return None
    bas = H - 1 - np.argmax(sel[::-1, cols], axis=0)
    seuil = np.percentile(bas, 55)
    garde = bas >= seuil
    if garde.sum() < 2:
        garde[:] = True
    a, b = np.polyfit(cols[garde], bas[garde], 1)
    return (a * np.arange(W) + b).astype(np.float32)


def reflet_miroir(lin, m, net):
    """Reflet de la scène dans une surface verticale brillante : ce qui est devant, au
    sol (parquet, meubles, lumière au sol), symétrique par rapport au pied de la surface,
    flou selon la finition et de plus en plus faible en montant."""
    H, W = m.shape
    base = ligne_de_base(m)
    if base is None:
        return np.zeros((H, W, 3), np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    distance = np.maximum(base[None, :] - yy, 0)
    src_y = (base[None, :] + distance).astype(np.float32)
    dans = src_y < H - 1
    img = cv2.remap(lin.astype(np.float32), xx, np.minimum(src_y, H - 1), cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_REPLICATE)
    sel = m > 0.5
    hauteur = max(float(np.ptp(np.nonzero(sel)[0])) if sel.any() else H, 8.0)
    attenue = np.exp(-distance / (0.45 * hauteur)) * dans
    img = img * attenue[..., None]
    if net > 0:
        img = _flou(img, net * max(H, W))
    return img


def rendre_surface(lin, m, albedo, finition='mat', lumiere=1.0, relief_origine=1.0, verticale=True, scene=None, lisse=1.0):
    """Nouvelle apparence linéaire d'une surface (avant fusion par le masque).
    relief_origine : part du micro-relief de l'ancienne surface à garder (1 pour une
    peinture qui épouse l'enduit ; faible pour un papier ou un sol, qui ont leur propre
    matière et ne doivent pas laisser voir les anciens joints).
    scene : image (linéaire) dont les reflets sont tirés, avec les finitions déjà posées
    (le nouveau parquet se reflète dans une porte laquée) ; par défaut la photo."""
    H, W = m.shape
    f = dict(BRILLANCE.get(finition, BRILLANCE['mat']))
    f['relief'] *= relief_origine
    for k in ('spec', 'voile', 'miroir'):
        f[k] *= lisse
    C, base, detail, _ = decomposer_lumiere(lin, m)
    base = np.maximum(1 + (base - 1) * float(lumiere), 0.02)
    # Profondeur : les finitions brillantes saturent un peu la teinte et creusent les ombres.
    alb = albedo.astype(np.float32)
    ya = luminance(alb)[..., None]
    alb = np.clip(ya + (alb - ya) * f['profondeur'], 0, 1)
    eclair = base ** f['profondeur']
    diffus = alb * C * eclair[:, :, None] * (detail ** f['relief'])[:, :, None]
    if f['spec'] <= 0:
        return diffus
    # Reflet de la lumière principale : seulement là où la surface est nettement plus
    # éclairée que d'habitude (près de la fenêtre, sous un spot), étalé selon la finition.
    # Valeur absolue : une porte éclairée uniformément n'a pas de tache de reflet.
    sel = m > 0.5
    ref = float(np.median(base[sel])) if sel.any() else 1.0
    h = np.clip((base / max(ref, 1e-3) - 1) / 0.8, 0, 1) ** 1.4
    h = _flou(h.astype(np.float32), f['lobe'] * max(H, W)) if f['lobe'] > 0 else h
    lum_source = (C * base[:, :, None])
    # Reflet d'environnement : ce qui entoure la surface (sol clair, mur, fenêtre) s'y
    # reflète, flou en satiné, plus net en brillant. Calculé hors de la surface, sinon
    # l'ancienne teinte reviendrait en voile laiteux.
    sigma = (0.012 + f['lobe'] * 0.6) * max(H, W)
    dehors = np.clip(1 - m, 0, 1).astype(np.float32)
    scene = lin if scene is None else scene
    env = _flou(scene.astype(np.float32) * dehors[..., None], sigma) /         np.maximum(_flou(dehors, sigma), 1e-3)[..., None]
    ye = luminance(env)[..., None]
    env = ye + (env - ye) * 0.6
    # Plus marqué vers le bas d'une surface verticale (angle rasant, effet de Fresnel).
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    env = env * (0.6 + 0.8 * yy)
    reflet = f['spec'] * (0.6 * h[:, :, None] * lum_source + 0.08 * env)
    if verticale and f['miroir'] > 0:
        reflet = reflet + f['miroir'] * reflet_miroir(scene, m, f['net'])
    # Voile : une peinture satinée renvoie un peu de la lumière qu'elle reçoit, sans
    # couleur (aspect laiteux) ; proportionnel à l'éclairage, jamais à l'ancienne teinte.
    voile = f['voile'] * 0.12 * lum_source
    return diffus * (1 - 0.5 * f['spec'] * h[:, :, None]) + reflet + voile


def separer_cadre(masque, epaisseur):
    """Sépare l'huisserie d'une porte sélectionnée avec son cadre : renvoie
    (porte sans cadre, cadre). Le cadre suit l'enveloppe extérieure de la sélection
    (haut et côtés, pas le bas qui touche le sol) : les trous laissés par un décor
    collé ou un meuble posé devant ne créent pas de faux cadre."""
    m = (masque > 0.5).astype(np.uint8)
    e = max(1, int(round(epaisseur)))
    H, W = m.shape
    enveloppe = np.zeros_like(m)
    pts = cv2.findNonZero(m)
    if pts is None:
        z = np.zeros(m.shape, np.float32)
        return z, z
    cv2.fillConvexPoly(enveloppe, cv2.convexHull(pts), 1)
    # Prolonge l'enveloppe vers le bas : aucun cadre sur le côté du sol.
    bas = int(pts[:, 0, 1].max())
    prolonge = np.zeros((H + 4 * e, W), np.uint8)
    prolonge[:H] = enveloppe
    prolonge[bas:] = np.maximum(prolonge[bas:], prolonge[bas:bas + 1])
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2 * e + 1, 2 * e + 1))
    interieur = cv2.erode(prolonge, k)[:H]
    cadre = (m * (1 - interieur)).astype(np.float32)
    feuille = (m * interieur).astype(np.float32)
    adoucir = lambda x: np.clip(cv2.GaussianBlur(x, (0, 0), 0.8), 0, 1)
    f, c = adoucir(feuille), adoucir(cadre)
    somme = np.maximum(f + c, 1e-6)
    return f / somme * np.clip(masque, 0, 1), c / somme * np.clip(masque, 0, 1)


def albedo_zone(z, m, shape):
    """Couleur ou motif à poser sur la zone (linéaire)."""
    H, W = shape
    kind = z['type']
    if kind == 'peinture':
        return np.broadcast_to(hex_lin(z['couleur'])[None, None, :], (H, W, 3)).astype(np.float32)
    tex = z.get('texture')
    if tex is None:
        if kind == 'enduit':
            return enduit_genere(hex_lin(z.get('couleur') or '#BDB8B1'), (H, W)).astype(np.float32)
        raise ValueError('Importez le motif ou la photo de ce revêtement')
    quad = z.get('quad')
    if quad is None:
        ys, xs = np.nonzero(m > 0.5)
        quad = [(xs.min(), ys.min()), (xs.max(), ys.min()), (xs.max(), ys.max()), (xs.min(), ys.max())]
    mode = 'miroir' if kind == 'enduit' else 'repeter'
    plaque = texture_plan(tex[:, :, :3], quad, (H, W), z.get('repetitions') or 4, mode)
    alb = srgb_lin(plaque).astype(np.float32)
    # La photo d'un motif ou d'un échantillon porte sa propre lumière : on la ramène à
    # une luminosité moyenne neutre pour que seul l'éclairage de la pièce s'applique.
    sel = m > 0.5
    if sel.any():
        moy = float(np.median(luminance(alb)[sel]))
        ref = float(np.median(luminance(srgb_lin(tex[:, :, :3]))))
        if moy > 1e-4 and ref > 1e-4:
            alb = np.clip(alb * (ref / moy), 0, 1)
    return alb


def appliquer(img, zones):
    """Applique les finitions de chaque zone ; renvoie l'image BGR finie.
    zone = {'masque': float HxW, 'type': 'peinture'|'papier'|'enduit'|'sol',
            'couleur': '#rrggbb', 'texture': BGR ou None, 'quad': 4 coins ou None,
            'repetitions': float, 'intensite_lumiere': float (1 = lumière d'origine),
            'finition': 'mat'|'velours'|'satin'|'brillant', 'surface': 'mur'|'plafond'|…}"""
    lin0 = srgb_lin(img)
    out = lin0.copy()
    H, W = img.shape[:2]
    # Sols d'abord : les reflets des surfaces verticales montrent le nouveau sol.
    sol = lambda z: z.get('surface') == 'sol' or z['type'] == 'sol'
    for z in sorted(zones, key=lambda z: 0 if sol(z) else 1):
        m = np.clip(z['masque'].astype(np.float32), 0, 1)
        if m.max() <= 0.01:
            continue
        m = etendre_bord(img, m)
        finition = z.get('finition') or FINITION_SURFACE.get(z.get('surface') or 'mur', 'mat')
        if finition not in BRILLANCE:
            raise ValueError('Finition inconnue')
        # Un papier peint, un enduit ou un sol a sa propre matière : l'ancien relief
        # (joints du carrelage, grain du mur) ne doit presque plus se voir.
        relief = 1.0 if z['type'] == 'peinture' else 0.15
        nouveau = rendre_surface(lin0, m, albedo_zone(z, m, (H, W)), finition, float(z.get('intensite_lumiere', 1.0)), relief,
                                  not sol(z) and z.get('surface') != 'plafond', out,
                                  LISSE_SURFACE.get(z.get('surface') or 'mur', 1.0))
        a = m[:, :, None]
        out = out * (1 - a) + nouveau * a
    return lin_srgb(out)
