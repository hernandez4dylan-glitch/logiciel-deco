"""« Optimisation finale » : retouche générative locale d'une composition validée.

Modèle : Stable Diffusion 1.5 inpainting (CreativeML OpenRAIL-M) avec LCM-LoRA fusionné
(OpenRAIL++), exporté en ONNX, exécuté par onnxruntime sur le processeur, sans réseau.
La consigne enregistrée (voir CONSIGNE) est pré-encodée dans modeles/consigne.npz :
rien à écrire pendant le rendez-vous.

Garanties :
- seules les zones utiles sont retouchées : un anneau autour du contour de chaque article
  ajouté et son ombre de contact ; partout ailleurs les pixels du montage sont gardés ;
- l'intérieur des articles (silhouette, couleurs, émail) n'est jamais régénéré ;
- cadrage et taille de l'image inchangés."""
from pathlib import Path
from threading import Lock
import os
import time

import cv2
import numpy as np

MODELES = Path(__file__).with_name('modeles')
CONSIGNE = ("Donne à cette composition le réalisme d’une photographie professionnelle d’architecture intérieure. "
            "Harmonise les contours, le grain et les ombres de contact des éléments ajoutés avec la photo. "
            "Respecte exactement la perspective, le cadrage, l’éclairage existant, les finitions choisies et la "
            "disposition des objets. Préserve l’identité de chaque article, le motif du papier peint et la matière de la chaux.")
# Auto-encodeur compact TAESD (MIT) à la place du VAE d'origine : 3 s au lieu de 40 s par
# vignette sur processeur ; le grain fin du montage est réinjecté ensuite.
FICHIERS = ('sd_unet.onnx', 'sd_unet.onnx.data', 'taesd_encodeur.onnx', 'taesd_decodeur.onnx', 'consigne.npz')
_sessions = {}
_verrou = Lock()


def disponible():
    return all((MODELES / f).is_file() for f in FICHIERS)


def _session(nom):
    with _verrou:
        if nom not in _sessions:
            import onnxruntime as ort
            o = ort.SessionOptions()
            o.intra_op_num_threads = max(2, (os.cpu_count() or 4) - 1)
            o.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            _sessions[nom] = ort.InferenceSession(str(MODELES / nom), o, providers=['CPUExecutionProvider'])
        return _sessions[nom]


# Planificateur LCM (Latent Consistency Model) — mêmes formules que diffusers.LCMScheduler,
# bêtas « scaled_linear » de Stable Diffusion 1.5.
BETAS = np.linspace(0.00085 ** 0.5, 0.012 ** 0.5, 1000, dtype=np.float64) ** 2
ALPHAS = np.cumprod(1.0 - BETAS)


def pas_lcm(etapes, force, origine=50):
    k = 1000 // origine
    n0 = max(1, int(origine * force))
    base = np.arange(1, n0 + 1) * k - 1
    saut = max(1, len(base) // etapes)
    return base[::-1][::saut][:etapes]


def _limites(t):
    s = t * 10.0
    return 0.25 / (s * s + 0.25), s / np.sqrt(s * s + 0.25)


def generer(image, masque, etapes=4, force=0.5, graine=0):
    """Retouche une vignette (RGB uint8, côtés multiples de 64). masque : 1 = à retoucher."""
    rng = np.random.default_rng(graine)
    h, w = image.shape[:2]
    x = (image.astype(np.float32) / 127.5 - 1).transpose(2, 0, 1)[None]
    m = (masque > 0.5).astype(np.float32)
    enc = _session('taesd_encodeur.onnx')
    lat_image = enc.run(None, {'image': x})[0]
    lat_masque_img = enc.run(None, {'image': x * (1 - m)[None, None]})[0]
    m_lat = cv2.resize(m, (w // 8, h // 8), interpolation=cv2.INTER_AREA)[None, None].astype(np.float32)
    texte = np.load(MODELES / 'consigne.npz')['positive'].astype(np.float32)
    unet = _session('sd_unet.onnx')
    ts = pas_lcm(etapes, force)
    bruit = rng.standard_normal(lat_image.shape).astype(np.float32)
    a0 = ALPHAS[ts[0]]
    lat = (np.sqrt(a0) * lat_image + np.sqrt(1 - a0) * bruit).astype(np.float32)
    for i, t in enumerate(ts):
        entree = np.concatenate([lat, m_lat, lat_masque_img], 1).astype(np.float32)
        eps = unet.run(None, {'latent': entree, 'temps': np.array([t], np.int64), 'texte': texte})[0]
        a_t = ALPHAS[t]
        x0 = (lat - np.sqrt(1 - a_t) * eps) / np.sqrt(a_t)
        c_skip, c_out = _limites(float(t))
        debruite = c_out * x0 + c_skip * lat
        if i < len(ts) - 1:
            a_p = ALPHAS[ts[i + 1]]
            lat = (np.sqrt(a_p) * debruite + np.sqrt(1 - a_p) * rng.standard_normal(lat.shape)).astype(np.float32)
        else:
            lat = debruite.astype(np.float32)
    out = _session('taesd_decodeur.onnx').run(None, {'latent': lat})[0][0]
    return np.clip((out.transpose(1, 2, 0) + 1) * 127.5, 0, 255).astype(np.uint8)


def zones_utiles(alpha, ombres=None):
    """Anneau autour du contour des articles ajoutés (dedans et dehors) et ombres de
    contact : seules zones retouchées. L'intérieur des articles reste intact."""
    H, W = alpha.shape
    a = (alpha > 0.5).astype(np.uint8)
    r_ext = max(3, round(max(H, W) * 0.006))
    r_int = max(2, round(max(H, W) * 0.002))
    ext = cv2.dilate(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r_ext + 1, 2 * r_ext + 1)))
    inte = cv2.erode(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r_int + 1, 2 * r_int + 1)))
    anneau = (ext > 0) & (inte == 0)
    if ombres is not None:
        anneau |= (ombres > 0.08) & (a == 0)
    return anneau.astype(np.float32)


def optimiser(composition, alpha, ombres=None, etapes=3, force=0.45, progression=None):
    """Composition BGR (montage), alpha des articles ajoutés (0..1), ombres (0..1).
    Renvoie (image optimisée BGR, masque des zones retouchées, durées)."""
    if not disponible():
        raise ValueError('Modèle d’optimisation absent (local/modeles)')
    t0 = time.perf_counter()
    H, W = alpha.shape
    zones = zones_utiles(alpha, ombres)
    if zones.sum() < 20:
        raise ValueError('Ajoutez au moins un article avant l’optimisation finale')
    # Une vignette par groupe d'articles proches (boîtes englobantes fusionnées).
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate((zones > 0).astype(np.uint8), np.ones((15, 15), np.uint8)))
    boites = []
    for i in range(1, n):
        x, y, w, h, aire = st[i]
        if aire < 50:
            continue
        cote = int(max(w, h) * 1.25) + 32
        cx, cy = x + w / 2, y + h / 2
        boites.append((cx, cy, cote))
    sortie = composition.astype(np.float32).copy()
    poids = np.zeros((H, W), np.float32)
    acc = np.zeros_like(sortie)
    rgb = cv2.cvtColor(composition, cv2.COLOR_BGR2RGB)
    for k, (cx, cy, cote) in enumerate(boites):
        x0, y0 = int(round(cx - cote / 2)), int(round(cy - cote / 2))
        # Petit article : vignette de 384 px (deux fois plus rapide), sinon 512 px.
        TAILLE = 384 if cote < 420 else 512
        # Vignette carrée (bords de l'image complétés par réplication).
        M = np.float32([[TAILLE / cote, 0, -x0 * TAILLE / cote], [0, TAILLE / cote, -y0 * TAILLE / cote]])
        vign = cv2.warpAffine(rgb, M, (TAILLE, TAILLE), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
        zv = cv2.warpAffine(zones, M, (TAILLE, TAILLE), flags=cv2.INTER_LINEAR)
        zv = cv2.dilate((zv > 0.2).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
        res = generer(vign, zv, etapes, force, graine=k)
        if progression:
            progression((k + 1) / len(boites))
        # Retour à l'échelle de l'image ; seules les zones utiles reçoivent la retouche.
        Mi = cv2.invertAffineTransform(M)
        back = cv2.warpAffine(cv2.cvtColor(res, cv2.COLOR_RGB2BGR).astype(np.float32), Mi, (W, H), flags=cv2.INTER_CUBIC)
        couv = cv2.warpAffine(np.ones((TAILLE, TAILLE), np.float32), Mi, (W, H), flags=cv2.INTER_LINEAR)
        acc += back * couv[..., None]
        poids += couv
    gen = acc / np.maximum(poids, 1e-6)[..., None]
    adouci = cv2.GaussianBlur(zones, (0, 0), max(1.0, max(H, W) / 900)) * (poids > 0.5)
    # Grain : on garde la texture fine du montage (la photo) et la couleur basse fréquence
    # de la retouche, pour ne pas lisser la matière.
    fin = sortie - cv2.GaussianBlur(sortie, (0, 0), 1.2)
    gen = cv2.GaussianBlur(gen, (0, 0), 1.2) + fin
    sortie = sortie * (1 - adouci[..., None]) + gen * adouci[..., None]
    return np.clip(sortie, 0, 255).astype(np.uint8), adouci, {'total': round(time.perf_counter() - t0, 1), 'vignettes': len(boites)}
