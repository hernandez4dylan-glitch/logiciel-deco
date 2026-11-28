"""Rendu photo réaliste par IA générative locale (module optionnel « runtime/ia-rendu »).

Lancé par le serveur dans un processus séparé, avec le Python du module IA :
    runtime/ia-rendu/python/python.exe local/rendu_ia.py <dossier_de_travail>

Le dossier contient :
    montage.jpg  le visuel de l'atelier (finitions et articles posés, pleine résolution)
    zones.png    surfaces habillées (blanc = à rendre réaliste)
    objets.png   silhouettes des articles posés (blanc = article)
    params.json  {"surfaces": [{"surface", "kind", "nom"}], "graine"}
Il reçoit :
    etat.json    {"progression": 0..1, "message", "erreur"?, "duree"?} mis à jour en continu
    resultat.jpg le visuel final, à la taille du montage

Principe : l'IA (Realistic Vision + ControlNet profondeur + LCM) redessine les surfaces
habillées et le pourtour des articles, guidée par la géométrie de la photo ; on lui reprend
ensuite la lumière et les ombres, mais la couleur exacte et les détails fins viennent du
montage (la teinte du nuancier, le motif du papier peint, le produit du catalogue)."""
import json, os, sys, time
from pathlib import Path

ICI = Path(__file__).resolve().parent
MODULE = ICI.parent / 'runtime' / 'ia-rendu'
os.environ.setdefault('HF_HOME', str(MODULE / 'hf'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['TRANSFORMERS_VERBOSITY'] = 'error'
os.environ['DIFFUSERS_VERBOSITY'] = 'error'

import cv2
import numpy as np

COTE = 768  # plus grand côté de l'image calculée par l'IA (multiple de 8)


def ecrire_etat(dossier, **etat):
    tmp = dossier / 'etat.tmp'
    tmp.write_text(json.dumps(etat, ensure_ascii=False), encoding='utf-8')
    os.replace(tmp, dossier / 'etat.json')


def consigne(surfaces):
    """Description (en anglais, langue du modèle) de la pièce habillée."""
    parts = []
    for s in surfaces:
        surf, kind, nom = s.get('surface'), s.get('kind'), (s.get('nom') or '').lower()
        if surf == 'sol':
            if 'béton' in nom or 'beton' in nom:
                parts.append('smooth polished concrete floor')
            elif 'carrel' in nom or 'tomette' in nom or 'marbre' in nom:
                parts.append('tiled floor')
            elif 'moquette' in nom:
                parts.append('carpet floor')
            elif 'vinyl' in nom or 'lino' in nom:
                parts.append('vinyl floor')
            else:
                parts.append('wooden parquet floor')
        elif surf == 'plafond':
            parts.append('painted ceiling')
        elif kind == 'papier':
            parts.append('wall covered with patterned wallpaper')
        elif kind == 'enduit':
            parts.append('lime plaster textured wall')
        elif surf in ('mur', None):
            parts.append('walls painted with matte paint')
    vus = list(dict.fromkeys(parts))
    return ('RAW photo, interior of a lived-in home, ' + ', '.join(vus + ['soft natural daylight',
            'realistic interior design photography', 'sharp focus', 'high detail']))


NEGATIF = ('cartoon, painting, illustration, 3d render, blurry, deformed, distorted, text, watermark, '
           'people, sun rays, sunbeam, light patch, overexposed')


def flou(x, sigma):
    """Flou gaussien ; les grands flous sont calculés sur une image réduite (rapide)."""
    if sigma < 8:
        return cv2.GaussianBlur(x, (0, 0), sigma)
    f = int(sigma // 4)
    H, W = x.shape[:2]
    p = cv2.resize(x, (max(1, W // f), max(1, H // f)), interpolation=cv2.INTER_AREA)
    return cv2.resize(cv2.GaussianBlur(p, (0, 0), sigma / f), (W, H), interpolation=cv2.INTER_LINEAR)


def flou_masque(x, m, sigma):
    """Moyenne locale de x pondérée par le masque m (σ en pixels)."""
    num = flou(x * m, sigma)
    den = flou(m, sigma)
    return num / np.maximum(den, 1e-4)


def recaler(gen, montage, zones, objets, pourtour=None):
    """Reprend la couleur et le détail du montage dans le rendu IA (pleine résolution).
    Autour des articles, l'IA ne peut qu'assombrir (ombres de contact), jamais éclaircir :
    pas de halo clair sous un fauteuil."""
    H, W = montage.shape[:2]
    grand = max(H, W)
    g = cv2.cvtColor(gen.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    m = cv2.cvtColor(montage.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    d = m - g
    out = g.copy()
    # Surfaces : teinte exacte du nuancier à l'échelle locale, luminosité moyenne de la pièce
    # (l'IA garde ses dégradés et ses ombres, pas une couleur qui dérive).
    if zones.any():
        for c in (1, 2):
            out[..., c] += flou_masque(d[..., c], zones, 0.02 * grand) * zones
        out[..., 0] += flou_masque(d[..., 0], zones, 0.12 * grand) * zones
    # Articles : le produit du catalogue reste fidèle, l'IA n'apporte que la lumière d'ambiance.
    if objets.any():
        for c in (0, 1, 2):
            out[..., c] += flou_masque(d[..., c], objets, 0.006 * grand) * objets * (0.75 if c == 0 else 1.0)
    res = cv2.cvtColor(out, cv2.COLOR_LAB2BGR) * 255
    # Détails (motif du papier peint, lames et grain du parquet, contours nets) repris du
    # montage : l'IA calcule en basse définition et apporte surtout lumière et ombres.
    mf = montage.astype(np.float32)
    detail = mf - flou(mf, max(1.0, 0.004 * grand))
    poids = np.clip(0.85 * zones + objets, 0, 1)[..., None]
    res = res + detail * poids
    if pourtour is not None:
        autour = np.clip(pourtour - objets, 0, 1)
        if autour.any():
            o = m.copy()
            o[..., 0] += np.minimum(0, flou(-d[..., 0], max(1.0, 0.004 * grand)))
            ombre = cv2.cvtColor(o, cv2.COLOR_LAB2BGR) * 255
            res = res * (1 - autour[..., None]) + ombre * autour[..., None]
    return res


def charger_pipeline():
    import torch
    from huggingface_hub import hf_hub_download
    from diffusers import (StableDiffusionInpaintPipeline, StableDiffusionControlNetInpaintPipeline,
                           ControlNetModel, AutoencoderKL, LCMScheduler)
    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 2))
    ckpt = hf_hub_download('SG161222/Realistic_Vision_V5.1_noVAE', 'Realistic_Vision_V5.1_fp16-no-ema-inpainting.safetensors')
    vae = AutoencoderKL.from_pretrained('stabilityai/sd-vae-ft-mse')
    base = StableDiffusionInpaintPipeline.from_single_file(
        ckpt, config='stable-diffusion-v1-5/stable-diffusion-inpainting', vae=vae, safety_checker=None)
    cn = ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32)
    pipe = StableDiffusionControlNetInpaintPipeline(
        **{k: v for k, v in base.components.items() if k != 'image_encoder'}, controlnet=cn)
    pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
    pipe.load_lora_weights('latent-consistency/lcm-lora-sdv1-5', weight_name='pytorch_lora_weights.safetensors')
    pipe.fuse_lora()
    pipe.set_progress_bar_config(disable=True)
    return pipe


def profondeur(img_rgb):
    from transformers import pipeline as tpipe
    from PIL import Image
    est = tpipe('depth-estimation', model='LiheYoung/depth-anything-small-hf')
    return est(Image.fromarray(img_rgb))['depth']


def rendre(dossier: Path):
    t0 = time.perf_counter()
    ecrire_etat(dossier, progression=0.02, message='Préparation de la photo…')
    montage = cv2.imread(str(dossier / 'montage.jpg'))
    if montage is None:
        raise ValueError('Visuel illisible')
    H, W = montage.shape[:2]
    lire = lambda n: (cv2.resize(cv2.imread(str(dossier / n), 0), (W, H)).astype(np.float32) / 255
                      if (dossier / n).is_file() else np.zeros((H, W), np.float32))
    zones, objets = lire('zones.png'), lire('objets.png')
    params = json.loads((dossier / 'params.json').read_text(encoding='utf-8')) if (dossier / 'params.json').is_file() else {}
    zones = zones * (1 - objets)
    k = max(3, int(0.05 * max(W, H)))
    pourtour = cv2.dilate(objets, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, max(3, k // 2))))
    a_rendre = np.maximum(zones, pourtour)
    if a_rendre.max() < 0.5:
        raise ValueError('Rien à rendre : posez une finition ou un article sur la photo')

    s = COTE / max(W, H)
    w, h = max(8, round(W * s / 8) * 8), max(8, round(H * s / 8) * 8)
    petit = cv2.resize(montage, (w, h), interpolation=cv2.INTER_AREA)
    petit_rgb = cv2.cvtColor(petit, cv2.COLOR_BGR2RGB)
    masque = cv2.resize(cv2.dilate(a_rendre, np.ones((5, 5), np.uint8)), (w, h), interpolation=cv2.INTER_AREA)

    ecrire_etat(dossier, progression=0.05, message='Lecture de la géométrie de la pièce…')
    from PIL import Image
    dep = profondeur(petit_rgb).resize((w, h)).convert('RGB')
    ecrire_etat(dossier, progression=0.12, message='Chargement du modèle d’image…')
    import torch
    pipe = charger_pipeline()

    etapes, force = 8, 0.6
    total = max(1, int(etapes * force))
    def suivi(_pipe, i, _t, kw):
        ecrire_etat(dossier, progression=round(0.2 + 0.72 * (i + 1) / total, 3),
                    message=f'Rendu réaliste : étape {i + 1} sur {total}…')
        return kw
    ecrire_etat(dossier, progression=0.2, message=f'Rendu réaliste : étape 1 sur {total}…')
    image = pipe(prompt=consigne(params.get('surfaces') or []), negative_prompt=NEGATIF,
                 image=Image.fromarray(petit_rgb), mask_image=Image.fromarray((np.clip(masque, 0, 1) * 255).astype(np.uint8)),
                 control_image=dep, height=h, width=w, num_inference_steps=etapes, strength=force,
                 guidance_scale=1.5, controlnet_conditioning_scale=0.9,
                 generator=torch.Generator().manual_seed(int(params.get('graine') or 7)),
                 callback_on_step_end=suivi).images[0]

    ecrire_etat(dossier, progression=0.94, message='Finitions et couleurs exactes…')
    brut = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    cv2.imwrite(str(dossier / 'ia-brut.png'), brut)  # pour diagnostic
    gen = cv2.resize(brut, (W, H), interpolation=cv2.INTER_LANCZOS4)
    fin = recaler(gen, montage, zones, objets, flou(pourtour, 0.01 * max(W, H)))
    m = flou(a_rendre, max(1.0, 0.004 * max(W, H)))[..., None]
    final = np.clip(montage.astype(np.float32) * (1 - m) + fin * m, 0, 255).astype(np.uint8)
    cv2.imwrite(str(dossier / 'resultat.tmp.jpg'), final, [cv2.IMWRITE_JPEG_QUALITY, 92])
    os.replace(dossier / 'resultat.tmp.jpg', dossier / 'resultat.jpg')
    duree = round(time.perf_counter() - t0, 1)
    ecrire_etat(dossier, progression=1.0, message='Terminé', duree=duree)
    return duree


if __name__ == '__main__':
    d = Path(sys.argv[1])
    try:
        print(json.dumps({'duree': rendre(d)}))
    except Exception as exc:  # l'écran affiche le message tel quel
        ecrire_etat(d, progression=1.0, message='Échec', erreur=str(exc) or exc.__class__.__name__)
        raise
