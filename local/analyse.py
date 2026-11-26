"""Reconnaissance automatique d'une pièce (photo ou rendu 3D), sans clic ni réseau.

1. Segmentation sémantique UperNet-ConvNeXt (ADE20K, 150 catégories, licence MIT) :
   murs, plafond, sol, portes, fenêtres, tableaux, meubles…
2. Profondeur Depth Anything V2 Small (Apache 2.0) : sépare les pans de mur. Pour un
   plan, l'inverse de la profondeur varie linéairement dans l'image : le profil de
   profondeur des murs, colonne par colonne, est formé de segments de droite dont les
   cassures sont les angles de la pièce.
3. Les contours sont recalés sur la photo (filtre guidé) : bords nets, menuiseries,
   meubles et tableaux exclus.
Modèles au format ONNX dans local/modeles, exécutés par onnxruntime sur le processeur."""
from pathlib import Path
from threading import Lock
import json
import time

import cv2
import numpy as np

from finitions import affiner

MODELES = Path(__file__).with_name('modeles')
TAILLE_SEG = 576   # entrée fixe du modèle (carte 18 × 18 divisible par la pyramide 1-2-3-6)
TAILLE_PROF = 518  # multiple de 14 (ViT de Depth Anything)
_sessions = {}
_verrou = Lock()

# Catégories ADE20K regroupées par rôle dans la pièce.
GROUPES = {
    'mur': {'wall', 'column, pillar'},
    'plafond': {'ceiling'},
    'sol': {'floor', 'flooring'},
    'porte': {'door', 'double door', 'screen door, screen'},
    'fenetre': {'windowpane', 'window', 'curtain', 'blind, screen', 'shower stall'},
    'tableau': {'painting, picture', 'mirror', 'poster', 'bulletin board', 'clock', 'screen, crt screen', 'television receiver'},
}


def _labels():
    return {int(k): v.strip() for k, v in json.loads((MODELES / 'ade20k_labels.json').read_text(encoding='utf-8')).items()}


def disponible():
    return (MODELES / 'piece_segmentation.onnx').is_file() and (MODELES / 'piece_profondeur.onnx').is_file()


def _session(nom):
    with _verrou:
        if nom not in _sessions:
            import onnxruntime as ort
            o = ort.SessionOptions()
            o.intra_op_num_threads = max(2, min(8, (__import__('os').cpu_count() or 4) - 1))
            _sessions[nom] = ort.InferenceSession(str(MODELES / nom), o, providers=['CPUExecutionProvider'])
        return _sessions[nom]


def _entree(img, w, h):
    x = cv2.cvtColor(cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    return ((x - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)).transpose(2, 0, 1)[None]


def segmenter(img):
    """Probabilités par catégorie (150 × h × w, à la taille de travail)."""
    lg = _session('piece_segmentation.onnx').run(None, {'image': _entree(img, TAILLE_SEG, TAILLE_SEG)})[0][0]
    lg = lg - lg.max(0, keepdims=True)
    p = np.exp(lg)
    return p / p.sum(0, keepdims=True)


def profondeur(img):
    H, W = img.shape[:2]
    if W >= H:
        w, h = 14 * max(1, round(TAILLE_PROF * W / H / 14)), TAILLE_PROF
    else:
        w, h = TAILLE_PROF, 14 * max(1, round(TAILLE_PROF * H / W / 14))
    d = _session('piece_profondeur.onnx').run(None, {'image': _entree(img, w, h)})[0][0]
    return cv2.resize(d.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)


def _segments(x, y, max_coupes=2, gain=0.35):
    """Découpe un profil en segments de droite (1 à 3 pans) : chaque segment est ajusté
    par moindres carrés (sommes cumulées : coût d'un segment en temps constant) ; une
    cassure n'est gardée que si elle divise l'erreur résiduelle par au moins 1/gain."""
    n = len(x)
    if n < 12:
        return []
    c = lambda v: np.concatenate([[0.0], np.cumsum(v, dtype=np.float64)])
    S1, Sx, Sy, Sxx, Sxy, Syy = c(np.ones(n)), c(x), c(y), c(x * x), c(x * y), c(y * y)

    def cout(i, j):  # erreur quadratique de la meilleure droite sur [i, j)
        m = S1[j] - S1[i]
        if m < 3:
            return np.inf
        sx, sy, sxx, sxy, syy = Sx[j] - Sx[i], Sy[j] - Sy[i], Sxx[j] - Sxx[i], Sxy[j] - Sxy[i], Syy[j] - Syy[i]
        vx = sxx - sx * sx / m
        cxy = sxy - sx * sy / m
        vy = syy - sy * sy / m
        return max(0.0, vy - (cxy * cxy / vx if vx > 1e-12 else 0.0))

    marge = max(3, n // 20)
    cand = range(marge, n - marge, max(1, n // 150))
    e0 = cout(0, n)
    e1, b1 = min(((cout(0, b) + cout(b, n), b) for b in cand), default=(np.inf, None))
    if b1 is None or not e1 < gain * e0:
        return []
    coupes = [b1]
    if max_coupes >= 2:
        e2, b2 = min(((cout(0, i) + cout(i, j) + cout(j, n), (i, j)) for i in cand for j in cand if j - i >= marge), default=(np.inf, None))
        if b2 is not None and e2 < 0.5 * gain * e1:
            coupes = list(b2)
    return [float(x[k]) for k in coupes]


def _arete(img, sel, x0, fenetre=0.15):
    """Affine la position d'un angle de la pièce : la colonne, autour de l'estimation par
    la profondeur, où la teinte du mur change le plus nettement d'un côté à l'autre
    (les deux pans ne reçoivent pas la même lumière)."""
    H, W = sel.shape
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 2), cv2.COLOR_BGR2LAB).astype(np.float32)
    d = 4
    a, b = max(d, int(x0 - fenetre * W)), min(W - d - 1, int(x0 + fenetre * W))
    meilleur, score_max, scores = x0, 0.0, []
    for x in range(a, b):
        lignes = sel[:, x - d] & sel[:, x + d]
        if lignes.sum() < 0.1 * H:
            scores.append(0.0)
            continue
        sc = float(np.median(np.linalg.norm(lab[lignes, x + d] - lab[lignes, x - d], axis=1)))
        scores.append(sc)
        if sc > score_max:
            meilleur, score_max = x, sc
    if not scores or score_max < max(4.0, 3 * float(np.median(scores))):
        return x0  # pas d'arête nette : on garde l'estimation par la profondeur
    return meilleur


def pans_de_mur(mur, prof, img=None, min_part=0.06):
    """Sépare la sélection des murs en pans (colonnes) aux angles de la pièce."""
    H, W = mur.shape
    sel = mur > 0.5
    cols = sel.sum(0)
    ok = cols > max(4, 0.02 * H)
    if ok.sum() < 10:
        return [mur]
    # Profondeur médiane des murs, colonne par colonne (normalisée 0..1).
    d = (prof - prof[sel].min()) / max(np.ptp(prof[sel]), 1e-6)
    def milieu(x):
        # Bas du mur dans la colonne (40 % inférieurs, hors plinthe) : un reste de plafond
        # mal classé est toujours en haut et ne fausse pas la profondeur du pan.
        v = d[:, x][sel[:, x]]
        n = len(v)
        return float(np.median(v[int(n * 0.55): max(int(n * 0.55) + 1, int(n * 0.95))]))
    prof_col = np.array([milieu(x) if ok[x] else 0 for x in range(W)], np.float32)
    xs = np.nonzero(ok)[0].astype(np.float32)
    ys = prof_col[ok]
    ys = cv2.GaussianBlur(ys.reshape(1, -1), (0, 0), max(1.0, W / 300)).ravel()
    cassures = _segments(xs / W, ys)
    bornes = [0] + sorted((_arete(img, sel, int(c * W)) if img is not None else int(c * W)) for c in cassures) + [W]
    pans = []
    for a, b in zip(bornes[:-1], bornes[1:]):
        m = np.zeros_like(mur)
        m[:, a:b] = mur[:, a:b]
        if (m > 0.5).sum() >= min_part * sel.sum():
            pans.append(m)
        elif pans:
            pans[-1] = np.maximum(pans[-1], m)
    return pans or [mur]


def _nettoyer(m, min_frac=0.002):
    """Retire les îlots minuscules (erreurs de classification)."""
    b = (m > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(b, connectivity=8)
    garde = st[:, 4] >= min_frac * m.size
    garde[0] = False
    return m * garde[lab]


def _recaler_mur(img, brut, proba):
    """Le modèle hésite parfois entre mur et porte dans un couloir vu par une porte
    ouverte. On repart des zones où il est sûr (cœur du mur) et on fait croître la
    sélection par couleur, comme la baguette : la lumière peut varier, la teinte non.
    Pour un papier peint à motif (couleurs multiples), la croissance couvre mal le
    mur : on garde alors la proposition du modèle."""
    from finitions import selectionner
    H, W = brut.shape
    k = max(3, round(max(H, W) / 120))
    coeur = cv2.erode(((proba > 0.85) & (brut > 0.5)).astype(np.uint8), np.ones((k, k), np.uint8)) > 0
    if coeur.sum() < 0.002 * H * W:
        return brut
    autres = cv2.erode(((proba < 0.1) & (brut < 0.5)).astype(np.uint8), np.ones((k, k), np.uint8)) > 0
    couleur = selectionner(img, coeur, autres, 1.0) > 0.5
    zone = cv2.dilate(brut.astype(np.uint8), np.ones((2 * k + 1, 2 * k + 1), np.uint8)) > 0
    couleur &= zone
    if couleur.sum() < 0.6 * (brut > 0.5).sum():
        return brut
    return couleur.astype(np.float32)


def _etendre_sous_objets(img, mur, objets):
    """La segmentation, calculée en basse résolution, « déborde » autour des objets fins
    (suspension, bouquet) : une bande de mur y est classée « objet ». On rend au mur les
    pixels de ces objets qui ont sa couleur et le touchent, sans franchir les contours."""
    from finitions import selectionner
    m = mur > 0.5
    if m.sum() < 1000 or not objets.any():
        return mur
    bord = m & (cv2.dilate(objets.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
    if bord.sum() < 20:
        return mur
    interdit = ~(m | objets)
    graines = cv2.erode(m.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    graines &= cv2.dilate(bord.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    pousse = (selectionner(img, graines, interdit, 0.8) > 0.5) & objets
    # Débordement seulement : une bande étroite autour du mur reconnu. Un meuble entier de
    # la couleur du mur (fauteuil beige devant un mur beige) n'est jamais rattaché au mur.
    H, W = m.shape
    dist = cv2.distanceTransform((~m).astype(np.uint8), cv2.DIST_L2, 3)
    pousse &= dist <= 0.025 * max(H, W)
    return np.maximum(mur, pousse.astype(np.float32))


def _plan(pan, prof, coeur, voisins=None, suspect=None):
    """Garde les pixels d'un pan dont la profondeur suit le plan du mur : l'inverse de la
    profondeur d'un plan est affine dans l'image. Un morceau de plafond ou de sol pris
    pour du mur s'en écarte nettement."""
    sel = (pan > 0.5) & coeur
    if sel.sum() < 500:
        return pan
    ys, xs = np.nonzero(sel)
    pas = max(1, len(xs) // 20000)
    A = np.stack([xs[::pas], ys[::pas], np.ones_like(xs[::pas])], 1).astype(np.float64)
    z = prof[ys[::pas], xs[::pas]].astype(np.float64)
    for _ in range(2):  # moindres carrés repondérés (robuste aux meubles mal classés)
        coef, *_ = np.linalg.lstsq(A, z, rcond=None)
        r = np.abs(A @ coef - z)
        garde = r < max(np.percentile(r, 80) * 2.5, 1e-6)
        A, z = A[garde], z[garde]
    H, W = pan.shape
    yy, xx = np.mgrid[0:H, 0:W]
    ecart = np.abs(prof - (coef[0] * xx + coef[1] * yy + coef[2]))
    amp = max(float(np.ptp(prof[pan > 0.5])), 1e-6)
    hors = (cv2.GaussianBlur((ecart > 0.12 * amp).astype(np.float32), (0, 0), 3) > 0.5) & (pan > 0.5)
    if voisins is not None:
        # Seuls les écarts reliés au plafond ou au sol sont des erreurs de classement ; un
        # écart au milieu du mur vient d'un objet devant (lampe) et n'est pas retiré.
        n, lab = cv2.connectedComponents(hors.astype(np.uint8))
        bord = cv2.dilate(voisins.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
        lies = np.unique(lab[bord & hors])
        hors = np.isin(lab, lies[lies > 0])
    if suspect is not None:
        # On ne retire que ce que le modèle soupçonne d'être du plafond ou du sol : deux
        # murs pris pour un seul pan (mur du fond + mur d'ascenseur) restent des murs.
        hors &= suspect
    return pan * ~hors


def _plinthes(img, sol, interdit):
    """Plinthes : bande basse posée sur le sol, sous un mur ou un habillage, délimitée en
    haut par une arête nette (changement de couleur). Recherche colonne par colonne
    juste au-dessus du bord du sol ; hauteur entre 0,5 % et 5 % de l'image ; on garde
    les tronçons continus (une plinthe court le long du mur)."""
    H, W = sol.shape
    s_ = sol > 0.5
    if s_.sum() < 0.01 * H * W:
        return np.zeros((H, W), np.float32)
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.2), cv2.COLOR_BGR2LAB).astype(np.float32)
    haut_sol = np.where(s_.any(0), s_.argmax(0), -1)
    hmin, hmax = max(3, int(0.005 * H)), max(6, int(0.05 * H))
    hauteur = np.zeros(W, np.int32)
    for x in range(W):
        y0 = haut_sol[x]
        if y0 < hmax + 4 or interdit[y0 - 2, x]:
            continue
        col = lab[y0 - hmax - 3:y0, x]
        # arête la plus forte dans la bande (différence entre 3 px au-dessus et au-dessous)
        d = np.linalg.norm(col[6:] - col[:-6], axis=1)
        if not len(d):
            continue
        k = int(np.argmax(d))
        if d[k] < 14:
            continue
        h = (len(col) - (k + 3))
        if hmin <= h <= hmax:
            # la plinthe elle-même est d'une couleur à peu près uniforme
            bande = lab[y0 - h + 1:y0 - 1, x]
            if len(bande) >= 2 and float(np.std(bande[:, 0])) < 14:
                hauteur[x] = h
    # lissage le long du mur et tronçons continus
    hl = cv2.medianBlur(hauteur.astype(np.uint8).reshape(1, -1) if hmax < 255 else hauteur.reshape(1, -1).astype(np.uint8), 9).ravel().astype(np.int32)
    ok = hl > 0
    plinthe = np.zeros((H, W), bool)
    debut = None
    for x in range(W + 1):
        if x < W and ok[x]:
            debut = x if debut is None else debut
            continue
        if debut is not None and x - debut >= 0.03 * W:
            xs = np.arange(debut, x)
            haut = haut_sol[xs] - hl[xs]
            a, b0 = np.polyfit(xs, haut, 1)
            # Une plinthe est droite : le pied arrondi d'un fauteuil ou d'un pouf ne l'est pas.
            if float(np.std(haut - (a * xs + b0))) > 0.004 * H:
                debut = None
                continue
            for xx in range(debut, x):
                y0 = haut_sol[xx]
                plinthe[max(0, y0 - hl[xx]):y0, xx] = True
        debut = None
    return cv2.GaussianBlur(plinthe.astype(np.float32), (0, 0), 0.8)


def _portes(img, portes, ep_rel=0.045):
    """Une surface par porte (composantes séparées) ; l'huisserie devient un « cadre »
    quand sa couleur se distingue du vantail."""
    from finitions import separer_cadre
    H, W = portes.shape
    b = (portes > 0.5).astype(np.uint8)
    n, lab_c, st, _ = cv2.connectedComponentsWithStats(b, connectivity=8)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    out = []
    for i in sorted(range(1, n), key=lambda i: st[i, 0]):
        x, y, w, h, aire = st[i]
        if aire < 0.004 * H * W:
            continue
        m = portes * (lab_c == i)
        ep = max(4, int(round(ep_rel * w)))
        feuille, cadre = separer_cadre(m, ep)
        fs, cs = feuille > 0.5, cadre > 0.5
        if cs.sum() > 50 and fs.sum() > 50:
            diff = float(np.linalg.norm(np.median(lab[fs], axis=0) - np.median(lab[cs], axis=0)))
            if diff > 10:
                out.append((feuille, cadre))
                continue
        out.append((m, None))
    return out


def _vers_plafond(img, pan, plafond, proba_plafond):
    """Haut d'un pan de mur qui a la couleur du plafond (bandeau sous un plafond uni, mal
    classé) : rendu au plafond. Le pan est comparé à sa propre couleur ; dans chaque
    colonne, on ne prend que la suite continue de pixels « plafond » depuis le haut."""
    if plafond is None:
        return pan, plafond
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.5), cv2.COLOR_BGR2LAB).astype(np.float32)
    m, c = pan > 0.5, plafond > 0.5
    if m.sum() < 500 or c.sum() < 500:
        return pan, plafond
    H, W = m.shape
    ys = np.nonzero(m)[0]
    bas = m & (np.arange(H)[:, None] > np.percentile(ys, 50))  # moitié basse : vraie couleur du pan
    ref_m = np.median(lab[bas], axis=0)
    ref_c = np.median(lab[c], axis=0)
    if np.linalg.norm(ref_m - ref_c) < 10:
        return pan, plafond
    # Couleur du mur dans la même colonne (même éclairage), lissée d'une colonne à l'autre.
    ref_col = np.tile(ref_m, (W, 1)).astype(np.float32)
    for x in np.nonzero(bas.any(0))[0]:
        ref_col[x] = np.median(lab[bas[:, x], x], axis=0)
    ref_col = cv2.GaussianBlur(ref_col[None], (0, 0), sigmaX=max(3, W / 100), sigmaY=0.1)[0]
    d_mur = np.linalg.norm(lab - ref_col[None, :, :], axis=2)
    proche = m & (np.linalg.norm(lab - ref_c, axis=2) < d_mur) & (d_mur > 8)
    # Suite continue depuis le haut du pan, colonne par colonne.
    premier = np.where(m.any(0), m.argmax(0), H)
    rupture = np.where((m & ~proche).any(0), (m & ~proche).argmax(0), H)
    yy = np.arange(H)[:, None]
    deplace = proche & (yy >= premier[None, :]) & (yy < rupture[None, :])
    # Seulement là où le modèle envisage lui-même un plafond : un mur clair sous un
    # plafond clair (couleurs proches) n'est jamais déplacé.
    deplace &= proba_plafond > 0.15
    deplace = cv2.morphologyEx(deplace.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0
    if deplace.sum() < 0.002 * H * W:
        return pan, plafond
    return pan * ~deplace, np.maximum(plafond, deplace.astype(np.float32))


def _par_couleur(img, pan, ecart=12.0, min_part=0.12):
    """Un pan qui réunit deux revêtements de couleurs franchement différentes (mur beige
    et habillage bleu-gris, mur d'accent) est séparé en deux surfaces : un clic sur le
    beige ne peint que le beige. La luminosité compte peu (lumière de fenêtre)."""
    m = pan > 0.5
    n = int(m.sum())
    if n < 2000:
        return [pan]
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 2), cv2.COLOR_BGR2LAB).astype(np.float32)
    # Teinte seule (direction a/b), plafonnée : un même jaune au soleil et à l'ombre change
    # de clarté et de saturation mais pas de teinte ; beige et bleu-gris s'opposent.
    ab = lab[m][:, 1:] - 128.0
    c = np.linalg.norm(ab, axis=1, keepdims=True)
    v = (ab * np.minimum(c, 15.0) / np.maximum(c, 1e-3)).astype(np.float32)
    ech = v[:: max(1, n // 40000)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    cv2.setRNGSeed(0)
    _, _, centres = cv2.kmeans(ech, 2, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    if np.linalg.norm(centres[0] - centres[1]) < ecart:
        return [pan]
    lab_px = np.argmin(((v[:, None, :] - centres[None, :, :]) ** 2).sum(2), axis=1)
    carte = np.full(m.shape, -1, np.int32)
    carte[m] = lab_px
    parts = []
    for k in (0, 1):
        g = (carte == k).astype(np.uint8)
        g = cv2.morphologyEx(g, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        nc, lc, st, _ = cv2.connectedComponentsWithStats(g, connectivity=8)
        if nc <= 1:
            parts.append(np.zeros(m.shape, bool))
            continue
        # La plus grande zone de cette teinte, plus celles presque aussi grandes ; un îlot
        # (bas de mur à l'ombre, reflet) revient à l'autre teinte.
        plus_grande = int(st[1:, 4].max())
        garde = st[:, 4] >= max(0.02 * n, 0.3 * plus_grande)
        garde[0] = False
        parts.append(garde[lc])
    if min(p.sum() for p in parts) < min_part * n:
        return [pan]
    # Les pixels non attribués (bords, petits îlots) vont à la partie voisine la plus proche.
    reste = m & ~parts[0] & ~parts[1]
    if reste.any():
        d0 = cv2.distanceTransform((~parts[0]).astype(np.uint8), cv2.DIST_L2, 3)
        d1 = cv2.distanceTransform((~parts[1]).astype(np.uint8), cv2.DIST_L2, 3)
        parts[0] = parts[0] | (reste & (d0 <= d1))
        parts[1] = parts[1] | (reste & (d1 < d0))
    out = []
    for q in parts:
        doux = cv2.GaussianBlur(q.astype(np.float32), (0, 0), 1.0)
        out.append(np.minimum(pan, doux))
    return out


def analyser(img):
    """Analyse complète. Renvoie {'zones': [...], 'temps': {...}, 'elements': {...}}.
    Chaque zone : {'nom', 'surface', 'masque' (float H×W), 'profondeur' (0 = loin)}."""
    if not disponible():
        raise ValueError('Modèles d’analyse absents (local/modeles)')
    t0 = time.perf_counter()
    H, W = img.shape[:2]
    probas = segmenter(img)
    t1 = time.perf_counter()
    prof = profondeur(img)
    t2 = time.perf_counter()
    noms = _labels()
    groupe_de = {}
    for i, n in noms.items():
        for g, ens in GROUPES.items():
            if n in ens:
                groupe_de[i] = g
    # Carte des groupes à la taille de l'image (probabilités agrégées puis lissées).
    groupes = list(GROUPES) + ['autre']
    pg = np.zeros((len(groupes),) + probas.shape[1:], np.float32)
    for i in range(probas.shape[0]):
        pg[groupes.index(groupe_de.get(i, 'autre'))] += probas[i]
    pg_full = np.stack([cv2.resize(c, (W, H), interpolation=cv2.INTER_LINEAR) for c in pg])
    lab = pg_full.argmax(0)
    masques = {}
    for g in ('mur', 'plafond', 'sol', 'porte'):
        brut = (lab == groupes.index(g)).astype(np.float32)
        if brut.mean() < (0.008 if g == 'porte' else 0.004):
            continue
        if g == 'mur':
            brut = _recaler_mur(img, brut, pg_full[groupes.index('mur')])
            brut = _etendre_sous_objets(img, brut, lab == groupes.index('autre'))
        elif g == 'porte':
            brut = brut * (pg_full[groupes.index('porte')] > 0.6)
        masques[g] = _nettoyer(affiner(img, brut))
    t3 = time.perf_counter()
    zones = []
    if 'mur' in masques:
        coeur = pg_full[groupes.index('mur')] > 0.6
        if 'sol' in masques:
            interdit = (masques['porte'] > 0.5) if 'porte' in masques else np.zeros((H, W), bool)
            masques['plinthe'] = _plinthes(img, masques['sol'], interdit)
            masques['mur'] = masques['mur'] * (1 - masques['plinthe'])
        voisins = np.zeros((H, W), bool)
        for g in ('plafond', 'sol'):
            if g in masques:
                voisins |= masques[g] > 0.5
        suspect = (pg_full[groupes.index('plafond')] + pg_full[groupes.index('sol')]) > 0.15
        pans = [_plan(m, prof, coeur, voisins, suspect) for m in pans_de_mur(masques['mur'], prof, img)]
        for i, m in enumerate(pans):
            pans[i], plaf = _vers_plafond(img, m, masques.get('plafond'), pg_full[groupes.index('plafond')])
            if plaf is not None:
                masques['plafond'] = plaf
        pans = [m for m in pans if (m > 0.5).sum() > 0.003 * H * W]
        pans = [q for m in pans for q in _par_couleur(img, m)]
        infos = []
        for m in pans:
            sel = m > 0.5
            xs = np.nonzero(sel.any(0))[0]
            infos.append((m, float(np.median(prof[sel])), xs.min() / W, xs.max() / W))
        loin = min(infos, key=lambda t: t[1])[1] if infos else 0
        for m, p, x0, x1 in infos:
            if len(infos) == 1:
                nom = 'Murs'
            elif p == loin:
                nom = 'Mur du fond'
            elif (x0 + x1) / 2 < 0.5:
                nom = 'Mur gauche'
            else:
                nom = 'Mur droit'
            zones.append({'nom': nom, 'surface': 'mur', 'masque': m, 'profondeur': p})
        # Noms uniques (deux pans à gauche…).
        vus = {}
        for z in zones:
            vus[z['nom']] = vus.get(z['nom'], 0) + 1
            if vus[z['nom']] > 1:
                z['nom'] += f" {vus[z['nom']]}"
    pm = lambda m: float(np.median(prof[m > 0.5])) if (m > 0.5).any() else 0.0
    for g, nom in (('plafond', 'Plafond'), ('sol', 'Sol')):
        if g in masques and (masques[g] > 0.5).mean() >= 0.003:
            zones.append({'nom': nom, 'surface': g, 'masque': masques[g], 'profondeur': pm(masques[g])})
    if 'plinthe' in masques and (masques['plinthe'] > 0.5).mean() >= 0.001:
        zones.append({'nom': 'Plinthes', 'surface': 'plinthe', 'masque': masques['plinthe'], 'profondeur': pm(masques['plinthe'])})
    if 'porte' in masques:
        for k, (feuille, cadre) in enumerate(_portes(img, masques['porte']), 1):
            zones.append({'nom': f'Porte {k}', 'surface': 'porte', 'masque': feuille, 'profondeur': pm(feuille)})
            if cadre is not None:
                zones.append({'nom': f'Cadre porte {k}', 'surface': 'cadre', 'masque': cadre, 'profondeur': pm(cadre)})
    elements = {g: round(float((lab == groupes.index(g)).mean() * 100), 1) for g in groupes}
    t4 = time.perf_counter()
    return {
        'zones': zones,
        'elements': elements,
        'temps': {'segmentation': round(t1 - t0, 2), 'profondeur': round(t2 - t1, 2), 'contours': round(t3 - t2, 2),
                  'pans': round(t4 - t3, 2), 'total': round(t4 - t0, 2)},
    }
