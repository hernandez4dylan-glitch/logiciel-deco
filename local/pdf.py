"""Proposition client en PDF, écrite directement (aucune bibliothèque) : A4, polices
Helvetica intégrées aux lecteurs PDF, images JPEG. Le contenu (visuel, liste, totaux)
vient tel quel de l'écran du studio, pour que le PDF reprenne exactement la version
affichée."""
import base64
import re
import zlib

import cv2
import numpy as np

A4 = (595.28, 841.89)
MARGE = 40


def _jpeg(data_url, cote_max=2400):
    raw = base64.b64decode(data_url.split(',', 1)[-1], validate=True)
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError('Image illisible pour le PDF')
    h, w = img.shape[:2]
    s = min(1.0, cote_max / max(h, w))
    if s < 1:
        img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise ValueError('Image du PDF impossible')
    return buf.tobytes(), img.shape[1], img.shape[0]


def _txt(s):
    s = str(s).replace(' ', ' ').replace(' ', ' ').replace('’', "'").replace('–', '-').replace('—', '-')
    b = s.encode('cp1252', errors='replace')
    return b.replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)')


def _eur(v):
    if v is None:
        return 'À renseigner'
    return f"{v:,.2f} €".replace(',', ' ').replace('.', ',')


def _q(v):
    return f"{v:g}".replace('.', ',')


class Page:
    def __init__(self):
        self.ops = []
        self.images = []

    def texte(self, x, y, s, taille=10, gras=False, gris=False):
        c = '0.45 g' if gris else '0.17 g'
        self.ops.append(f"BT {c} /{'F2' if gras else 'F1'} {taille} Tf {x:.2f} {y:.2f} Td (".encode() + _txt(s) + b") Tj ET")

    def texte_droite(self, x, y, s, taille=10, gras=False):
        largeur = len(str(s)) * taille * (0.56 if gras else 0.52)
        self.texte(x - largeur, y, s, taille, gras)

    def ligne(self, x1, y1, x2, y2, gris=0.8):
        self.ops.append(f"{gris} G 0.6 w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S".encode())

    def rect(self, x, y, w, h, rgb):
        r, g, b = rgb
        self.ops.append(f"{r:.3f} {g:.3f} {b:.3f} rg {x:.2f} {y:.2f} {w:.2f} {h:.2f} re f".encode())

    def image(self, jpeg, iw, ih, x, y, w, h):
        nom = f"Im{len(self.images) + 1}"
        self.images.append((nom, jpeg, iw, ih))
        self.ops.append(f"q {w:.2f} 0 0 {h:.2f} {x:.2f} {y:.2f} cm /{nom} Do Q".encode())


def _hex(c):
    if not c or not re.fullmatch('#[0-9a-fA-F]{6}', c):
        return None
    return tuple(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))


def _couper(s, n):
    s = str(s)
    return s if len(s) <= n else s[:n - 1] + '…'


def proposition(d):
    """Construit le PDF ; renvoie les octets."""
    W, H = A4
    pages = []
    p = Page()
    pages.append(p)
    y = H - MARGE
    p.texte(MARGE, y - 18, d.get('titre') or 'Proposition', 20, True)
    sous = ' · '.join(x for x in [d.get('client'), d.get('variante'), d.get('date')] if x)
    p.texte(MARGE, y - 36, sous, 10, gris=True)
    p.texte_droite(W - MARGE, y - 18, d.get('boutique') or 'Un Instant Chez Moi', 11, True)
    y -= 52
    apres, aw, ah = _jpeg(d['apres'])
    larg = W - 2 * MARGE
    haut = larg * ah / aw
    if haut > 430:
        haut = 430
        larg = haut * aw / ah
    p.texte(MARGE, y - 12, 'Visuel proposé', 11, True)
    y -= 18
    p.image(apres, aw, ah, MARGE + (W - 2 * MARGE - larg) / 2, y - haut, larg, haut)
    y -= haut + 18
    if d.get('avant'):
        avant, bw, bh = _jpeg(d['avant'], 1400)
        lb = (W - 2 * MARGE) * 0.42
        hb = lb * bh / bw
        if y - hb - 20 < MARGE:
            hb = max(60, y - MARGE - 20)
            lb = hb * bw / bh
        p.texte(MARGE, y - 12, "Photo d'origine", 11, True)
        p.image(avant, bw, bh, MARGE, y - 18 - hb, lb, hb)
        sel = d.get('selection') or {}
        # Résumé à droite de la photo d'origine
        xr = MARGE + lb + 20
        yr = y - 30
        p.texte(xr, yr, 'En résumé', 11, True)
        yr -= 16
        for f in (sel.get('finitions') or [])[:6]:
            p.texte(xr, yr, _couper(f"{', '.join(f.get('zones') or [])} : {f.get('nom')}", 52), 9)
            yr -= 12
        nb = sum(o.get('quantite', 0) for o in sel.get('objets') or [])
        if nb:
            p.texte(xr, yr, f"{nb} objet{'s' if nb > 1 else ''} du catalogue", 9)
            yr -= 12
        p.texte(xr, yr - 6, f"Total TTC{' (partiel)' if sel.get('partiel') else ''} : {_eur(sel.get('total'))}", 11, True)

    # Page 2 : liste d'achat
    sel = d.get('selection') or {}
    p = Page()
    pages.append(p)
    y = H - MARGE
    p.texte(MARGE, y - 16, 'Liste des références et quantités', 16, True)
    p.texte(MARGE, y - 32, d.get('titre') or '', 10, gris=True)
    y -= 56
    cols = [MARGE, MARGE + 205, MARGE + 300, MARGE + 395]  # désignation, quantité, PU, total (droite)

    def entete(titre, yy):
        p.texte(MARGE, yy, titre, 11, True)
        yy -= 14
        p.texte(cols[0], yy, 'Désignation', 8, gris=True)
        p.texte(cols[1], yy, 'Quantité', 8, gris=True)
        p.texte(cols[2], yy, 'Prix unitaire', 8, gris=True)
        p.texte_droite(W - MARGE, yy, 'Total TTC', 8)
        p.ligne(MARGE, yy - 4, W - MARGE, yy - 4)
        return yy - 16

    def nouvelle_page(yy, besoin):
        nonlocal p
        if yy - besoin > MARGE + 20:
            return yy
        p = Page()
        pages.append(p)
        return H - MARGE - 20

    if sel.get('finitions'):
        y = entete('Finitions (peintures, papiers, sols)', y)
        for f in sel['finitions']:
            y = nouvelle_page(y, 40)
            rgb = _hex(f.get('color'))
            if rgb:
                p.rect(cols[0], y - 2, 9, 9, rgb)
            nom = ' – '.join(x for x in [f.get('marque'), f.get('nom')] if x) + (f", {f['aspect']}" if f.get('aspect') else '')
            p.texte(cols[0] + 14, y, _couper(nom, 40), 9, True)
            q = f.get('quantite')
            u = f.get('unite', '')
            if q is not None and q > 1 and u and not u.endswith(('s', 'x')) and ' ' not in u:
                u += 's'
            p.texte(cols[1], y, f"{q} {u}" if q is not None else 'À renseigner', 9)
            p.texte(cols[2], y, _eur(f.get('prixUnitaire')) + (f" / {f.get('unite')}" if f.get('prixUnitaire') is not None else ''), 9)
            p.texte_droite(W - MARGE, y, _eur(f.get('total')), 9, True)
            y -= 12
            m2 = f.get('m2')
            det = f"réf. {f.get('reference') or '-'} · {', '.join(f.get('zones') or [])} · "
            det += (f"{_q(m2)} m²" if m2 is not None else 'surface à renseigner')
            if f.get('couches', 1) > 1:
                det += f" × {f['couches']} couches"
            if f.get('m2ParUnite'):
                det += f" · {_q(f['m2ParUnite'])} m² par {f.get('unite')} (hors marge)"
            p.texte(cols[0] + 14, y, _couper(det, 105), 8, gris=True)
            y -= 16
        y -= 6
    if sel.get('objets'):
        y = nouvelle_page(y, 60)
        y = entete('Objets du catalogue', y)
        for o in sel['objets']:
            y = nouvelle_page(y, 30)
            p.texte(cols[0], y, _couper(o.get('nom', ''), 42), 9, True)
            p.texte(cols[1], y, str(o.get('quantite', 0)), 9)
            p.texte(cols[2], y, _eur(o.get('prixUnitaire')), 9)
            p.texte_droite(W - MARGE, y, _eur(o.get('total')), 9, True)
            y -= 12
            p.texte(cols[0], y, f"réf. {o.get('sku', '')}", 8, gris=True)
            y -= 16
    y = nouvelle_page(y, 70)
    p.ligne(MARGE, y, W - MARGE, y, 0.4)
    y -= 16
    if sel.get('remise'):
        p.texte(cols[2], y, 'Sous-total TTC', 9)
        p.texte_droite(W - MARGE, y, _eur(sel.get('sousTotal')), 9)
        y -= 13
        p.texte(cols[2], y, f"Remise {sel['remise']} %", 9)
        p.texte_droite(W - MARGE, y, '-' + _eur((sel.get('sousTotal') or 0) - (sel.get('total') or 0)), 9)
        y -= 13
    p.texte(cols[2], y, 'Total TTC' + (' (partiel)' if sel.get('partiel') else ''), 11, True)
    p.texte_droite(W - MARGE, y, _eur(sel.get('total')), 11, True)
    y -= 18
    if sel.get('partiel'):
        manques = '; '.join(sel.get('manques') or [])
        p.texte(MARGE, y, _couper('Total partiel - à renseigner : ' + manques, 110), 8, gris=True)
        y -= 12
    p.texte(MARGE, MARGE - 10, "Quantités calculées sans marge de coupe. Visuel non contractuel : les teintes à l'écran peuvent différer de l'échantillon.", 7, gris=True)
    return _assembler(pages)


def _assembler(pages):
    W, H = A4
    objets = []

    def ajout(b):
        objets.append(b)
        return len(objets)

    f1 = ajout(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    f2 = ajout(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    racine_pages = ajout(b'')  # rempli plus bas
    kids = []
    for pg in pages:
        xo = []
        for nom, jpeg, iw, ih in pg.images:
            n = ajout(f"<< /Type /XObject /Subtype /Image /Width {iw} /Height {ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpeg)} >>\nstream\n".encode() + jpeg + b"\nendstream")
            xo.append(f"/{nom} {n} 0 R")
        contenu = zlib.compress(b"\n".join(pg.ops))
        c = ajout(f"<< /Length {len(contenu)} /Filter /FlateDecode >>\nstream\n".encode() + contenu + b"\nendstream")
        res = f"<< /Font << /F1 {f1} 0 R /F2 {f2} 0 R >> /XObject << {' '.join(xo)} >> >>"
        kids.append(ajout(f"<< /Type /Page /Parent {racine_pages} 0 R /MediaBox [0 0 {W} {H}] /Resources {res} /Contents {c} 0 R >>".encode()))
    objets[racine_pages - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()
    catalogue = ajout(f"<< /Type /Catalog /Pages {racine_pages} 0 R >>".encode())
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    positions = []
    for i, o in enumerate(objets, 1):
        positions.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objets) + 1}\n0000000000 65535 f \n".encode()
    for pos in positions:
        out += f"{pos:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objets) + 1} /Root {catalogue} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)
