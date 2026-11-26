"""Serveur monoposte et lanceur Windows pour Atelier Stock Symphony."""
import subprocess
import argparse, io, json, mimetypes, os, re, sqlite3, sys, threading, urllib.request, webbrowser, zipfile
from contextlib import closing
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote
from data import dispatch, migrer

ROOT=Path(__file__).resolve().parent
WEB=ROOT.parent/'dist'
USER_DIR=Path(os.getenv('ATELIER_DATA') or Path(os.getenv('LOCALAPPDATA') or Path.home())/'AtelierStockSymphony')
DB=USER_DIR/'boutique.sqlite3'
IMAGES=USER_DIR/'photos'
GATE=threading.RLock()
SIGNATURE=b'AtelierStockLocal-v1'
def dbopen():
    db=sqlite3.connect(DB,timeout=30)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db
def initialize():
    IMAGES.mkdir(parents=True,exist_ok=True)
    with closing(dbopen()) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='products'").fetchone():
            db.executescript('BEGIN IMMEDIATE;\n'+(ROOT/'init.sql').read_text(encoding='utf-8')+'\nCOMMIT;')
        migrer(db)
class Handler(BaseHTTPRequestHandler):
    def reply(self,status,body,mime,filename=None):
        self.send_response(status)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; font-src 'self' data:; frame-ancestors 'none'")
        if filename: self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        try:
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError,ConnectionResetError,BrokenPipeError):
            pass  # l'écran a annulé la demande (aperçu remplacé par un plus récent) : rien à faire
    def allowed(self,write=False):
        authority=f'127.0.0.1:{self.server.server_port}'
        return self.headers.get('Host')==authority and (not write or self.headers.get('Origin')=='http://'+authority)
    def do_GET(self):
        if not self.allowed(): return self.reply(403,b'Forbidden','text/plain')
        path=unquote(urlsplit(self.path).path)
        if path=='/api/health': return self.reply(200,SIGNATURE,'text/plain')
        if path=='/api/backup':
            buf=io.BytesIO()
            with GATE, zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as out:
                out.write(DB,DB.name)
                for f in IMAGES.iterdir():
                    if f.is_file(): out.write(f,'photos/'+f.name)
            return self.reply(200,buf.getvalue(),'application/zip','Sauvegarde_Atelier.zip')
        source=IMAGES if path.startswith('/photos/') else WEB
        f=(source/(path[8:] if source==IMAGES else path.lstrip('/'))).resolve()
        if not f.is_relative_to(source.resolve()): return self.reply(403,b'Forbidden','text/plain')
        if not f.is_file() and source==WEB and '.' not in path and not path.startswith('/api/'): f=WEB/'index.html'
        if not f.is_file(): return self.reply(404,b'Introuvable','text/plain')
        mime={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}.get(f.suffix) or mimetypes.guess_type(f.name)[0] or 'application/octet-stream'
        self.reply(200,f.read_bytes(),mime)
    def do_POST(self):
        if not self.allowed(True):
            # Corps lu (et jeté) avant le refus : sinon Windows coupe la connexion et le
            # client ne reçoit pas la réponse 403.
            try:
                n=int(self.headers.get('Content-Length',0))
                if 0<n<=1024*1024: self.rfile.read(n)
            except (TypeError,ValueError,OSError): pass
            return self.reply(403,b'Forbidden','text/plain')
        try:
            n=int(self.headers.get('Content-Length',0))
            if n<=0 or n>64*1024*1024: raise ValueError('Fichier trop grand ou vide')
            raw=self.rfile.read(n)
            if self.path.startswith('/api/upload/'):
                name=unquote(self.path[12:])
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,110}\.(?:png|jpe?g|webp|gif|avif)',name,re.I): raise ValueError('Format de photo non pris en charge')
                with GATE, (IMAGES/name).open('xb') as f: f.write(raw)
                result=None
            elif self.path=='/api/photo':
                from photo import render
                out=render(json.loads(raw))
                # Analyse de pièce et optimisation : réponse JSON (zones, durées) ; sinon une image PNG.
                if isinstance(out,dict): return self.reply(200,json.dumps({'data':out,'error':None}).encode(),'application/json')
                return self.reply(200,out,'image/png')
            elif self.path=='/api/data':
                with GATE, closing(dbopen()) as db, db:
                    result=dispatch(db,json.loads(raw))
            else: return self.reply(404,b'Introuvable','text/plain')
            self.reply(200,json.dumps({'data':result,'error':None}).encode(),'application/json')
        except Exception as exc:
            message=str(exc)
            if 'UNIQUE constraint failed: products.sku' in message:
                message='Cette référence SKU existe déjà.'
            self.reply(400,json.dumps({'error':{'message':message}}).encode(),'application/json')
def open_window(url):
    if os.name=="nt":
        for directory in (os.getenv("ProgramFiles(x86)"),os.getenv("ProgramFiles")):
            if directory:
                edge=Path(directory)/"Microsoft"/"Edge"/"Application"/"msedge.exe"
                if edge.is_file():
                    subprocess.Popen([str(edge),"--app="+url])
                    return
    webbrowser.open(url)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--port',type=int,default=48631)
    args=parser.parse_args()
    url=f'http://127.0.0.1:{args.port}'
    try: server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    except OSError:
        if urllib.request.urlopen(url+'/api/health',timeout=2).read()==SIGNATURE:
            if not args.no_browser: open_window(url)
            sys.exit(0)
        raise
    initialize()
    print('Atelier Stock Symphony   '+url,flush=True)
    if not args.no_browser: threading.Timer(.4,lambda:open_window(url)).start()
    server.serve_forever()
