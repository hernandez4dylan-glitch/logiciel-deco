"""Tâches de rendu photo réaliste par IA (module optionnel runtime/ia-rendu).

Le calcul dure de une à quelques minutes sur processeur : il tourne dans un processus
séparé, en priorité basse (le logiciel reste fluide), un seul à la fois. L'écran suit la
progression puis récupère l'image, rangée dans le dossier photos comme les autres visuels."""
import base64, binascii, json, os, re, shutil, subprocess, tempfile, threading, uuid
from pathlib import Path

ICI = Path(__file__).resolve().parent
MODULE = ICI.parent / 'runtime' / 'ia-rendu'
PYTHON = MODULE / 'python' / ('python.exe' if os.name == 'nt' else 'bin/python3')
TRAVAIL = Path(tempfile.gettempdir()) / 'AtelierRenduIA'
_VERROU = threading.Lock()
_TACHES: dict[str, dict] = {}


def disponible():
    return PYTHON.is_file() and (MODULE / 'hf' / 'hub').is_dir()


def _image(data_url, nom, dossier):
    m = re.match(r'data:image/(png|jpeg);base64,(.*)$', data_url or '', re.S)
    if not m:
        raise ValueError(f'Image « {nom} » invalide')
    try:
        (dossier / nom).write_bytes(base64.b64decode(m.group(2), validate=True))
    except binascii.Error as exc:
        raise ValueError(f'Image « {nom} » invalide') from exc


def _en_cours():
    return [t for t in _TACHES.values() if t['proc'].poll() is None]


def lancer(d):
    """Démarre un rendu ; renvoie son identifiant."""
    if not disponible():
        raise ValueError('Module de rendu IA absent (dossier runtime\\ia-rendu)')
    with _VERROU:
        if _en_cours():
            raise ValueError('Un rendu réaliste est déjà en cours : attendez qu’il se termine')
        ident = uuid.uuid4().hex
        dossier = TRAVAIL / ident
        dossier.mkdir(parents=True)
        try:
            _image(d.get('montage'), 'montage.jpg', dossier)
            _image(d.get('zones'), 'zones.png', dossier)
            if d.get('objets'):
                _image(d.get('objets'), 'objets.png', dossier)
            surfaces = [{k: str(s.get(k) or '')[:80] for k in ('surface', 'kind', 'nom')}
                        for s in (d.get('surfaces') or [])[:40] if isinstance(s, dict)]
            (dossier / 'params.json').write_text(json.dumps({'surfaces': surfaces, 'graine': int(d.get('graine') or 7)}),
                                                 encoding='utf-8')
            opts = {}
            if os.name == 'nt':
                opts['creationflags'] = subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS
            proc = subprocess.Popen([str(PYTHON), '-I', str(ICI / 'rendu_ia.py'), str(dossier)],
                                    stdout=subprocess.DEVNULL, stderr=(dossier / 'journal.txt').open('wb'), **opts)
        except Exception:
            shutil.rmtree(dossier, ignore_errors=True)
            raise
        _TACHES[ident] = {'proc': proc, 'dossier': dossier, 'image': None}
        return ident


def etat(ident, images: Path):
    """Progression d'un rendu ; à la fin, l'image est rangée dans le dossier photos."""
    t = _TACHES.get(ident)
    if not t:
        raise ValueError('Rendu introuvable (le logiciel a peut-être été redémarré)')
    if t.get('final'):
        return t['final']
    dossier = t['dossier']
    try:
        e = json.loads((dossier / 'etat.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        e = {'progression': 0.01, 'message': 'Démarrage du module IA…'}
    fini = t['proc'].poll() is not None
    if fini and t['image'] is None and not e.get('erreur'):
        res = dossier / 'resultat.jpg'
        if t['proc'].returncode == 0 and res.is_file():
            nom = f'rendu-ia-{ident}.jpg'
            shutil.copyfile(res, images / nom)
            t['image'] = nom
        else:
            try:
                lignes = (dossier / 'journal.txt').read_text(encoding='utf-8', errors='replace').strip().splitlines()
            except OSError:
                lignes = []
            e['erreur'] = (lignes[-1] if lignes else 'Le module IA s’est arrêté') [:300]
    r = {'progression': e.get('progression', 0), 'message': e.get('message', ''), 'erreur': e.get('erreur'),
         'image': t['image'], 'duree': e.get('duree'), 'termine': fini}
    if fini:
        t['final'] = r
        shutil.rmtree(dossier, ignore_errors=True)
    return r


def annuler(ident):
    t = _TACHES.get(ident)
    if t and t['proc'].poll() is None:
        t['proc'].kill()
        t['proc'].wait(10)
    if t:
        shutil.rmtree(t['dossier'], ignore_errors=True)
        _TACHES.pop(ident, None)
