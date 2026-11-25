"""Tests du moteur du studio : murs (sélection, peinture, papier peint, enduit) et détourage.
Images synthétiques uniquement. Lancement : runtime\\windows\\python.exe local\\tests\\test_studio.py"""
import base64, sys, unittest
from pathlib import Path

LOCAL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LOCAL))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import detourage, finitions, photo  # noqa: E402


def piece(h=300, w=420):
    """Pièce : plafond blanc, mur orange éclairé par la gauche, porte blanche, sol gris."""
    img = np.zeros((h, w, 3), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    lumiere = 1.15 - 0.55 * xx / w  # fenêtre à gauche
    orange = np.array([30, 140, 235], np.float32)
    img[:] = orange * lumiere[:, :, None]
    img[: int(0.18 * h)] = (238, 240, 240)
    img[int(0.68 * h):] = (110, 112, 115)
    porte = (slice(int(0.3 * h), int(0.68 * h)), slice(int(0.55 * w), int(0.7 * w)))
    img[porte] = (225, 226, 228)
    rng = np.random.default_rng(1)
    img = np.clip(img + rng.normal(0, 2, img.shape), 0, 255).astype(np.uint8)
    mur = np.zeros((h, w), bool)
    mur[int(0.18 * h):int(0.68 * h)] = True
    mur[porte] = False
    return img, mur, porte


def data_url(img):
    ok, buf = cv2.imencode('.png', img)
    assert ok
    return 'data:image/png;base64,' + base64.b64encode(buf.tobytes()).decode()


def png(raw):
    return cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)


class SelectionTests(unittest.TestCase):
    def test_baguette_selectionne_le_mur_sans_porte_ni_plafond(self):
        img, mur, porte = piece()
        h, w = mur.shape
        plus = np.zeros((h, w), bool)
        plus[int(0.45 * h) - 2:int(0.45 * h) + 3, int(0.2 * w) - 2:int(0.2 * w) + 3] = True
        m = finitions.selectionner(img, plus, np.zeros((h, w), bool)) > 0.5
        self.assertGreater(m[mur].mean(), 0.9, 'mur sélectionné')
        self.assertLess(m[porte].mean(), 0.03, 'porte protégée')
        self.assertLess(m[: int(0.16 * h)].mean(), 0.02, 'plafond protégé')
        self.assertLess(m[int(0.7 * h):].mean(), 0.02, 'sol protégé')

    def test_trait_pas_le_mur_protege(self):
        img, mur, _ = piece()
        h, w = mur.shape
        plus = np.zeros((h, w), bool)
        plus[150, 60] = True
        moins = np.zeros((h, w), bool)
        moins[60:200, 300:420] = True  # « pas le mur » sur toute la droite
        m = finitions.selectionner(img, plus, moins) > 0.5
        self.assertFalse(m[60:200, 300:420].any())
        self.assertGreater(m[60:200, 20:200].mean(), 0.85)


class PeintureTests(unittest.TestCase):
    def test_peinture_garde_la_lumiere_et_ne_deborde_pas(self):
        img, mur, porte = piece()
        res = finitions.appliquer(img, [{'masque': mur.astype(np.float32), 'type': 'peinture', 'couleur': '#D8C7AE'}])
        lum = lambda a: cv2.cvtColor(a, cv2.COLOR_BGR2LAB)[:, :, 0].astype(float)
        h, w = mur.shape
        bande = slice(int(0.25 * h), int(0.6 * h))
        g_avant = lum(img)[bande, 10:60].mean() - lum(img)[bande, 360:410].mean()
        g_apres = lum(res)[bande, 10:60].mean() - lum(res)[bande, 360:410].mean()
        self.assertGreater(g_apres, 0.5 * g_avant, 'le côté fenêtre reste plus lumineux')
        self.assertGreater(g_apres, 15)
        # Teinte : au milieu du mur, la couleur est proche du beige demandé.
        lab = cv2.cvtColor(res, cv2.COLOR_BGR2LAB).astype(float)
        cible = cv2.cvtColor(np.uint8([[[174, 199, 216]]]), cv2.COLOR_BGR2LAB)[0, 0].astype(float)
        milieu = lab[bande, 180:220].reshape(-1, 3).mean(0)
        self.assertLess(np.abs(milieu[1:] - cible[1:]).max(), 6, (milieu, cible))
        # Aucun débordement sur la porte, le plafond, le sol.
        self.assertTrue(np.array_equal(res[porte], img[porte]))
        self.assertTrue(np.array_equal(res[:50], img[:50]))
        # Pas d'aplat : le grain de la photo reste.
        self.assertGreater(res[bande, 180:220].std(), 0.5)

    def test_papier_peint_en_perspective(self):
        img, mur, _ = piece()
        motif = np.zeros((40, 40, 3), np.uint8)
        motif[:20, :20] = motif[20:, 20:] = (40, 90, 60)
        motif[:20, 20:] = motif[20:, :20] = (200, 210, 190)
        h, w = mur.shape
        quad = [(20, 60), (400, 40), (400, 210), (20, 200)]
        res = finitions.appliquer(img, [{'masque': mur.astype(np.float32), 'type': 'papier', 'texture': motif, 'quad': quad, 'repetitions': 8}])
        zone = res[70:190, 40:200].astype(float)
        self.assertGreater(zone.std(), 25, 'le motif est visible')
        self.assertTrue(np.array_equal(res[:50], img[:50]))
        # Perspective : les motifs sont plus petits à droite (côté fuyant) qu'à gauche.
        def periode(col0):
            ligne = cv2.cvtColor(res, cv2.COLOR_BGR2GRAY)[120, col0:col0 + 60].astype(float)
            return np.count_nonzero(np.diff(np.sign(ligne - ligne.mean())))
        self.assertGreaterEqual(periode(330), periode(40))

    def test_enduit_avec_photo_echantillon(self):
        img, mur, porte = piece()
        ech = cv2.imread(str(LOCAL.parent / 'public' / 'images' / 'motifs' / 'enduit-taloche.jpg'))
        self.assertIsNotNone(ech, 'échantillon livré manquant')
        res = finitions.appliquer(img, [{'masque': mur.astype(np.float32), 'type': 'enduit', 'texture': ech, 'repetitions': 1.5}])
        # La couleur suit l'échantillon (beige : rouge > vert > bleu), pas l'orange d'origine.
        m = res[mur].astype(float).mean(0)
        self.assertGreater(m[2], m[1])
        self.assertGreater(m[1], m[0])
        self.assertLess(m[2] - m[0], 60)
        self.assertTrue(np.array_equal(res[porte], img[porte]))

    def test_enduit_sans_echantillon(self):
        img, mur, _ = piece()
        res = finitions.appliquer(img, [{'masque': mur.astype(np.float32), 'type': 'enduit', 'couleur': '#BDB8B1'}])
        self.assertFalse(np.array_equal(res[mur], img[mur]))
        with self.assertRaises(ValueError):
            finitions.appliquer(img, [{'masque': mur.astype(np.float32), 'type': 'papier'}])


class DetourageTests(unittest.TestCase):
    def test_detourage_alpha_et_couleurs(self):
        img = np.full((240, 240, 3), (60, 170, 60), np.uint8)  # fond vert
        cv2.rectangle(img, (70, 60), (170, 170), (235, 235, 235), -1)  # objet blanc
        cv2.rectangle(img, (75, 170), (80, 215), (40, 40, 40), -1)  # pied fin
        cv2.rectangle(img, (160, 170), (165, 215), (40, 40, 40), -1)
        out = detourage.detourer(img, photo.matte)
        self.assertEqual(out.shape, (240, 240, 4))
        a = out[:, :, 3]
        self.assertGreater(a[115, 120], 240)
        self.assertLess(a[10, 10], 10)
        self.assertLess(a[230, 230], 10)
        # Bords décontaminés : pas de liseré vert sur le blanc.
        bord = (a > 40) & (a < 215)
        if bord.any():
            px = out[:, :, :3][bord].astype(int)
            self.assertLess(np.mean(px[:, 1] - (px[:, 0] + px[:, 2]) / 2), 25)
        cut, indice = detourage.detourer(img, photo.matte, avec_indice=True)
        self.assertEqual(indice.shape, (240, 240))
        self.assertGreater(indice[200, 77], indice[10, 10])

    def test_filtre_guide_conserve_un_bord_net(self):
        g = np.zeros((50, 50, 3), np.float32)
        g[:, 25:] = 1
        src = np.zeros((50, 50), np.float32)
        src[:, 23:] = 1  # masque décalé de 2 px
        out = detourage.filtre_guide(g, src, 4, 1e-4)
        self.assertLess(out[25, 20], 0.2)
        self.assertGreater(out[25, 30], 0.8)


class ApiTests(unittest.TestCase):
    def test_modes_du_studio(self):
        img, mur, _ = piece()
        h, w = mur.shape
        plus = np.zeros((h, w, 4), np.uint8)
        cv2.circle(plus, (80, 140), 3, (255, 255, 255, 255), -1)
        sel = png(photo.render({'image': data_url(img), 'mode': 'select', 'plus': data_url(plus), 'tolerance': 1}))
        self.assertEqual(sel.shape, (h, w))
        self.assertGreater((sel > 127)[mur].mean(), 0.85)
        aff = png(photo.render({'image': data_url(img), 'mode': 'affiner', 'mask': data_url(sel)}))
        self.assertEqual(aff.shape, (h, w))
        fin = png(photo.render({'image': data_url(img), 'mode': 'finish', 'zones': [{'mask': data_url(sel), 'type': 'peinture', 'couleur': '#A9B5A0', 'lumiere': 1}]}))
        self.assertEqual(fin.shape, img.shape)
        vierge = cv2.imdecode(np.frombuffer(photo.render({'mode': 'vierge', 'width': 600, 'height': 400}), np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(vierge.shape, (400, 600, 3))
        cut = png(photo.render({'image': data_url(img), 'mode': 'cutout'}))
        self.assertEqual(cut.shape, (h, w, 4))
        for bad in (
            {'mode': 'select', 'plus': data_url(np.zeros((h, w, 4), np.uint8))},
            {'mode': 'select'},
            {'mode': 'finish', 'zones': [{'mask': data_url(sel), 'type': 'vernis'}]},
            {'mode': 'finish', 'zones': [{'mask': data_url(sel), 'type': 'peinture', 'couleur': 'beige'}]},
            {'mode': 'finish', 'zones': [{'mask': data_url(sel), 'type': 'papier', 'quad': [[0, 0], [1, 1]]}]},
            {'mode': 'affiner', 'mask': data_url(np.zeros((10, 10), np.uint8))},
        ):
            with self.assertRaises(ValueError, msg=str(bad)):
                photo.render({'image': data_url(img), **bad})
        with self.assertRaises(ValueError):
            photo.render({'mode': 'vierge', 'width': 99999})


if __name__ == '__main__':
    unittest.main(verbosity=2)
