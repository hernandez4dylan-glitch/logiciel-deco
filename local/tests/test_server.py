"""Tests du serveur local : sécurité (Host/Origin, dossiers, tailles) et sauvegarde.
Les données vont dans un dossier temporaire (ATELIER_DATA), jamais dans %LOCALAPPDATA%.
Lancement : runtime\\windows\\python.exe local\\tests\\test_server.py"""
import http.client, io, json, os, sys, tempfile, threading, unittest, zipfile
from pathlib import Path

TMP = tempfile.TemporaryDirectory(prefix='atelier-test-')
os.environ['ATELIER_DATA'] = TMP.name
LOCAL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LOCAL))
import server  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert str(server.USER_DIR) == TMP.name
        server.initialize()
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.httpd.server_port
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def req(self, method, path, body=None, host=None, origin=True, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=30)
        h = {'Host': host or f'127.0.0.1:{self.port}'}
        if origin and method == 'POST':
            h['Origin'] = f'http://127.0.0.1:{self.port}'
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
            h['Content-Type'] = 'application/json'
        h.update(headers or {})
        c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        for k, v in h.items():
            c.putheader(k, v)
        if body is not None:
            c.putheader('Content-Length', str(len(body)))
        c.endheaders(body)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data, r

    def test_ecoute_locale_seulement(self):
        self.assertEqual(self.httpd.server_address[0], '127.0.0.1')

    def test_host_et_origin(self):
        self.assertEqual(self.req('GET', '/api/health')[0], 200)
        self.assertEqual(self.req('GET', '/api/health', host='evil.example:80')[0], 403)
        self.assertEqual(self.req('GET', '/api/health', host='localhost:%d' % self.port)[0], 403)
        body = {'table': 'products', 'op': 'select'}
        self.assertEqual(self.req('POST', '/api/data', body)[0], 200)
        self.assertEqual(self.req('POST', '/api/data', body, origin=False)[0], 403)
        self.assertEqual(self.req('POST', '/api/data', body, headers={'Origin': 'http://evil.example'})[0], 403)

    def test_pas_de_sortie_des_dossiers(self):
        for path in ('/photos/..%2fboutique.sqlite3', '/photos/../boutique.sqlite3', '/..%2f..%2flocal%2fserver.py', '/photos/%2e%2e/boutique.sqlite3'):
            status, data, _ = self.req('GET', path)
            self.assertIn(status, (403, 404), path)
            self.assertNotIn(b'SQLite format', data)

    def test_envoi_photo(self):
        png = b'\x89PNG\r\n\x1a\n' + b'0' * 20
        self.assertEqual(self.req('POST', '/api/upload/essai_1.png', png)[0], 200)
        status, data, _ = self.req('GET', '/photos/essai_1.png')
        self.assertEqual((status, data), (200, png))
        self.assertEqual(self.req('POST', '/api/upload/essai_1.png', png)[0], 400)  # pas d'écrasement
        self.assertEqual(self.req('POST', '/api/upload/..%2fx.png', png)[0], 400)
        self.assertEqual(self.req('POST', '/api/upload/x.exe', png)[0], 400)

    def test_limite_de_taille(self):
        status, data, _ = self.req('POST', '/api/data', b'', headers={'Content-Length': str(65 * 1024 * 1024)})
        self.assertEqual(status, 400)

    def test_erreurs_lisibles(self):
        status, data, _ = self.req('POST', '/api/data', {'table': 'products', 'op': 'insert', 'values': {'sku': 'LUM-CER-001', 'name': 'x', 'category': 'Textile'}})
        self.assertEqual(status, 400)
        self.assertIn('SKU', json.loads(data)['error']['message'])

    def test_sauvegarde_zip(self):
        status, data, r = self.req('GET', '/api/backup')
        self.assertEqual(status, 200)
        self.assertEqual(r.getheader('Content-Type'), 'application/zip')
        names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        self.assertIn('boutique.sqlite3', names)

    def test_page_et_routes(self):
        status, data, r = self.req('GET', '/catalogue')
        self.assertEqual(status, 200)
        self.assertIn(b'<div id="root">', data)
        self.assertIn("frame-ancestors 'none'", r.getheader('Content-Security-Policy'))


if __name__ == '__main__':
    try:
        unittest.main(verbosity=2)
    finally:
        TMP.cleanup()
