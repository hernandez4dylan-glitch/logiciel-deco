"""Détourage U²-Net et retouches locales (gomme, recoloration, décor). Aucun appel réseau."""
from pathlib import Path
from threading import Lock
import base64
import re
import cv2
import numpy as np
from gomme import remplir
from retouche import changer_decor, couvrir, decor_genere, hex_bgr, isoler
from detourage import detourer, sur_fond
from finitions import BRILLANCE, FINITION_SURFACE, affiner, appliquer, selectionner, separer_cadre

cv2.setNumThreads(2)
network=None
lock=Lock()

def decode(data):
    raw=base64.b64decode(data.split(',',1)[-1],validate=True)
    img=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_UNCHANGED)
    if img is None or img.size==0 or img.shape[0]*img.shape[1]>36000000:
        raise ValueError('Image illisible ou trop grande (36 mégapixels maximum)')
    if img.ndim==2: img=cv2.cvtColor(img,cv2.COLOR_GRAY2BGR)
    if img.dtype!=np.uint8: raise ValueError('Utilisez une image 8 bits')
    return img

def masque(p,cle,img,optionnel=False):
    """Masque de sélection envoyé par le studio : alpha (ou gris) 0..255 → 0..1,
    à la taille de l'image."""
    if not p.get(cle):
        if optionnel: return np.zeros(img.shape[:2],np.float32)
        raise ValueError('Masque manquant')
    m=decode(p[cle])
    m=m[:,:,3] if m.shape[2]==4 else cv2.cvtColor(m,cv2.COLOR_BGR2GRAY)
    if m.shape[:2]!=img.shape[:2]: raise ValueError('Taille du masque incompatible')
    return m.astype(np.float32)/255.0

def matte(img):
    global network
    if img.shape[2]==4 and img[:,:,3].min()<245: return img[:,:,3]
    rgb=cv2.cvtColor(cv2.resize(img[:,:,:3],(320,320),interpolation=cv2.INTER_AREA),cv2.COLOR_BGR2RGB)
    values=rgb.astype(np.float32)/max(1,int(rgb.max()))
    blob=((values-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)).transpose(2,0,1)[None]
    with lock:
        if network is None: network=cv2.dnn.readNetFromONNX(str(Path(__file__).with_name('u2netp.onnx')))
        network.setInput(blob)
        m=network.forward(network.getUnconnectedOutLayersNames()[0])[0,0]
    m=cv2.normalize(m,None,0,255,cv2.NORM_MINMAX).astype(np.uint8)
    return cv2.resize(m,(img.shape[1],img.shape[0]),interpolation=cv2.INTER_LINEAR)

def render(p):
    if p.get('mode')=='vierge':
        # Pièce vierge générée (mur teinté et sol) pour démarrer sans photo.
        try: w,h=int(p.get('width') or 1800),int(p.get('height') or 1200)
        except (TypeError,ValueError): raise ValueError('Format invalide')
        if not (200<=w<=4000 and 200<=h<=4000): raise ValueError('Format invalide')
        style=p.get('style') or 'parquet'
        if style not in ('parquet','beton','uni'): raise ValueError('Sol inconnu')
        color=p.get('color') or '#EFEAE1'
        if not re.fullmatch('#[a-fA-F0-9]{6}',color): raise ValueError('Couleur invalide')
        ok,encoded=cv2.imencode('.jpg',decor_genere(h,w,hex_bgr(color),style,.64),[cv2.IMWRITE_JPEG_QUALITY,92])
        return encoded.tobytes()
    img=decode(p['image'])
    if img.shape[2]==4 and p.get('mode') not in ('cutout','showroom'): img=img[:,:,:3]
    rgb=img[:,:,:3].copy()
    mode=p.get('mode','showroom')
    if mode in ('repaint','erase'):
        mask=decode(p['mask'])
        if mask.shape[:2]!=img.shape[:2] or mask.shape[2]!=4: raise ValueError('Taille du masque incompatible')
        painted=(mask[:,:,3]<250).astype(np.uint8)*255
        if not painted.any(): raise ValueError('Peignez d’abord la zone à modifier')
        if mode=='erase':
            # On déborde de quelques pixels pour ne pas laisser de liseré de l'objet.
            grow=max(3,round(min(rgb.shape[:2])/250))
            hole=cv2.dilate(painted,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*grow+1,2*grow+1)))>0
            result=remplir(rgb,hole)
        else:
            color=p['color']
            if not re.fullmatch('#[a-fA-F0-9]{6}',color): raise ValueError('Couleur invalide')
            bgr=np.uint8([[[int(color[i:i+2],16) for i in (5,3,1)]]])
            lab=cv2.cvtColor(rgb,cv2.COLOR_BGR2LAB)
            newlab=cv2.cvtColor(bgr,cv2.COLOR_BGR2LAB)[0,0]
            lum=lab[:,:,0].astype(float)
            lab[:,:,0]=np.clip(newlab[0]+(lum-np.median(lum[painted>0]))*.75,0,255)
            lab[:,:,1:]=newlab[1:]
            tinted=cv2.cvtColor(lab,cv2.COLOR_LAB2BGR)
            weight=cv2.GaussianBlur(painted,(5,5),0)[:,:,None]/255.
            result=(rgb*(1-weight)+tinted*weight).astype(np.uint8)
    elif mode=='decor':
        mask=decode(p['mask'])
        if mask.shape[:2]!=img.shape[:2] or mask.shape[2]!=4: raise ValueError('Taille du masque incompatible')
        keep=mask[:,:,3]<250
        if not keep.any(): raise ValueError('Peignez d’abord les meubles à conserver')
        h,w=rgb.shape[:2]
        if p.get('decor'):
            decor=couvrir(decode(p['decor'])[:,:,:3],h,w)
        else:
            color=p.get('color') or '#E3D5C0'
            if not re.fullmatch('#[a-fA-F0-9]{6}',color): raise ValueError('Couleur invalide')
            style=p.get('style') or 'parquet'
            if style not in ('parquet','beton','uni'): raise ValueError('Sol inconnu')
            try: horizon=float(p.get('horizon') or .62)
            except (TypeError,ValueError): raise ValueError('Hauteur de plinthe invalide')
            decor=decor_genere(h,w,hex_bgr(color),style,horizon)
        alpha=isoler(rgb,keep,matte)
        if alpha.max()<.5: raise ValueError('Aucun meuble reconnu dans la zone peinte')
        result=changer_decor(rgb,alpha,decor)
    elif mode in ('cutout','showroom'):
        cut=detourer(img,matte)
        if mode=='cutout': result=cut
        else:
            color=p.get('note') or '#ebe7df'
            if not re.fullmatch('#[a-fA-F0-9]{6}',color): raise ValueError('Fond invalide')
            result=sur_fond(cut,hex_bgr(color))
    elif mode=='indice':
        # Carte « ce pixel tranche sur le fond » pour le pinceau de restauration intelligent.
        _,indice=detourer(rgb,matte,avec_indice=True)
        result=indice
    elif mode=='select':
        plus=masque(p,'plus',img)>0.5
        moins=masque(p,'moins',img,optionnel=True)>0.5
        try: tol=float(p.get('tolerance') or 1)
        except (TypeError,ValueError): raise ValueError('Tolérance invalide')
        result=np.round(selectionner(rgb,plus,moins,float(np.clip(tol,.3,3)))*255).astype(np.uint8)
    elif mode=='affiner':
        result=np.round(affiner(rgb,masque(p,'mask',img))*255).astype(np.uint8)
    elif mode=='analyse':
        # Reconnaissance de la pièce : zones (murs par pan, plafond, sol, portes) en PNG.
        import analyse
        r=analyse.analyser(rgb)
        zones=[]
        for z in r['zones']:
            ok,buf=cv2.imencode('.png',np.round(np.clip(z['masque'],0,1)*255).astype(np.uint8))
            if not ok: raise ValueError('Export du masque impossible')
            zones.append({'nom':z['nom'],'surface':z['surface'],'profondeur':round(float(z['profondeur']),3),
                          'part':round(float((z['masque']>0.5).mean()),4),
                          'masque':'data:image/png;base64,'+base64.b64encode(buf.tobytes()).decode()})
        return {'zones':zones,'temps':r['temps'],'elements':r['elements']}
    elif mode=='optimiser':
        # Optimisation finale : retouche générative limitée aux contours et ombres des articles.
        import optimisation
        def calque(cle):
            m=decode(p[cle]) if p.get(cle) else None
            if m is None: return np.zeros(rgb.shape[:2],np.float32)
            if m.shape[:2]!=rgb.shape[:2]: raise ValueError('Taille du calque incompatible')
            return (m[:,:,3] if m.shape[2]==4 else cv2.cvtColor(m,cv2.COLOR_BGR2GRAY)).astype(np.float32)/255.0
        articles=calque('articles')
        ombres=np.clip(calque('ombres')-articles,0,1)
        out,zones,temps=optimisation.optimiser(rgb,articles,ombres)
        ok1,b1=cv2.imencode('.png',out)
        ok2,b2=cv2.imencode('.png',np.round(zones*255).astype(np.uint8))
        if not (ok1 and ok2): raise ValueError('Export PNG impossible')
        return {'image':'data:image/png;base64,'+base64.b64encode(b1.tobytes()).decode(),
                'zones':'data:image/png;base64,'+base64.b64encode(b2.tobytes()).decode(),
                'temps':temps,'consigne':optimisation.CONSIGNE}
    elif mode=='cadre':
        # Sépare une porte sélectionnée avec son huisserie : 'partie' = 'cadre' ou 'porte'.
        try: ep=float(p.get('epaisseur') or 12)
        except (TypeError,ValueError): raise ValueError('Épaisseur invalide')
        feuille,cadre=separer_cadre(masque(p,'mask',img),float(np.clip(ep,2,80)))
        if p.get('partie') not in ('cadre','porte'): raise ValueError('Partie inconnue')
        result=np.round((cadre if p.get('partie')=='cadre' else feuille)*255).astype(np.uint8)
    elif mode=='finish':
        zones=[]
        for z in p.get('zones') or []:
            kind=z.get('type')
            if kind not in ('peinture','papier','enduit','sol'): raise ValueError('Finition inconnue')
            surface=z.get('surface') or 'mur'
            if surface not in FINITION_SURFACE: raise ValueError('Surface inconnue')
            finition=z.get('finition') or None
            if finition is not None and finition not in BRILLANCE: raise ValueError('Finition inconnue')
            color=z.get('couleur')
            if color is not None and not re.fullmatch('#[a-fA-F0-9]{6}',color): raise ValueError('Couleur invalide')
            if kind=='peinture' and color is None: raise ValueError('Choisissez une teinte')
            quad=z.get('quad')
            if quad is not None:
                quad=[(float(x),float(y)) for x,y in quad]
                if len(quad)!=4: raise ValueError('Il faut 4 coins pour le papier peint')
            zones.append({'masque':masque(z,'mask',img),'type':kind,'couleur':color,
                          'texture':decode(z['texture'])[:,:,:3] if z.get('texture') else None,
                          'quad':quad,'repetitions':float(z.get('repetitions') or 4),
                          'intensite_lumiere':float(np.clip(float(z.get('lumiere') or 1),0,2)),
                          'finition':finition,'surface':surface,
                          'rotation':float(np.clip(float(z.get('rotation') or 0),-360,360))})
        result=appliquer(rgb,zones)
    else: raise ValueError('Retouche inconnue')
    ok,encoded=cv2.imencode('.png',result)
    if not ok: raise ValueError('Export PNG impossible')
    return encoded.tobytes()
