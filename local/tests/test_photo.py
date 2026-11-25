"""Tests du moteur photo local (gomme, décor, API render) sur des images synthétiques.
Lancement : runtime\\windows\\python.exe local\\tests\\test_photo.py"""
import base64, sys, unittest
from pathlib import Path

LOCAL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LOCAL))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import gomme, retouche  # noqa: E402
from photo import render  # noqa: E402


def carrelage(h=240, w=320, pas=24):
    img = np.full((h, w, 3), (150, 150, 152), np.uint8)
    rng = np.random.default_rng(0)
    img = np.clip(img + rng.normal(0, 3, img.shape), 0, 255).astype(np.uint8)
    img[::pas, :] = (90, 90, 92)
    img[:, ::pas] = (90, 90, 92)
    return img


def data_url(img):
    ok, buf = cv2.imencode('.png', img)
    assert ok
    return 'data:image/png;base64,' + base64.b64encode(buf.tobytes()).decode()


def masque(h, w, zone):
    """Masque façon studio : transparent (alpha 0) là où l'on a peint."""
    m = np.zeros((h, w, 4), np.uint8)
    m[:, :, 3] = 255
    m[zone, 3] = 0
    return m


def png(raw):
    return cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)


class GommeTests(unittest.TestCase):
    def test_prolonge_le_carrelage_mieux_que_la_diffusion(self):
        vrai = carrelage()
        hole = np.zeros(vrai.shape[:2], bool)
        hole[90:160, 130:205] = True
        abime = vrai.copy()
        abime[hole] = (40, 40, 200)  # « objet » rouge à effacer
        res = gomme.remplir(abime, hole)
        telea = cv2.inpaint(abime, hole.astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
        err = lambda im: np.abs(im[hole].astype(float) - vrai[hole]).mean()
        self.assertLess(err(res), err(telea) * 0.85, (err(res), err(telea)))
        # Plus aucune trace de rouge, et des joints sombres bien présents dans la zone.
        self.assertLess(res[hole][:, 2].astype(int).mean() - res[hole][:, 0].astype(int).mean(), 12)
        self.assertGreater((res[hole][:, 0] < 115).mean(), 0.04)
        # Hors zone, rien ne bouge (au raccord près).
        loin = ~cv2.dilate(hole.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
        self.assertTrue(np.array_equal(res[loin], abime[loin]))

    def test_plusieurs_zones_independantes(self):
        vrai = carrelage()
        hole = np.zeros(vrai.shape[:2], bool)
        hole[20:50, 20:60] = True
        hole[150:200, 230:290] = True
        abime = vrai.copy()
        abime[hole] = (0, 0, 255)
        res = gomme.remplir(abime, hole)
        self.assertLess(np.abs(res[hole].astype(float) - vrai[hole]).mean(), 25)

    def test_zone_vide(self):
        img = carrelage()
        self.assertTrue(np.array_equal(gomme.remplir(img, np.zeros(img.shape[:2], bool)), img))


class DecorTests(unittest.TestCase):
    def scene(self):
        img = carrelage()
        cv2.circle(img, (160, 130), 45, (40, 50, 190), -1)
        traits = np.zeros(img.shape[:2], bool)
        traits[75:190, 105:215] = True  # trait large qui déborde de l'objet
        return img, traits

    def test_isoler_garde_l_objet_et_retire_le_fond(self):
        img, traits = self.scene()
        alpha = retouche.isoler(img, traits)
        self.assertGreater(alpha[130, 160], 0.9)
        self.assertLess(alpha[80, 110], 0.2)   # coin du trait : du carrelage
        self.assertLess(alpha[10, 10], 0.01)    # hors du trait

    def test_changer_decor_et_ombre(self):
        img, traits = self.scene()
        h, w = img.shape[:2]
        decor = retouche.decor_genere(h, w, retouche.hex_bgr('#9CAF97'), 'parquet', 0.6)
        self.assertEqual(decor.shape, img.shape)
        alpha = retouche.isoler(img, traits)
        out = retouche.changer_decor(img, alpha, decor)
        self.assertGreater(int(out[130, 160, 2]), 150)  # l'objet rouge est conservé
        self.assertLess(np.abs(out[20, 20].astype(int) - decor[20, 20]).max(), 6)  # le fond devient le décor
        self.assertLess(out[180, 160].mean(), decor[180, 160].mean())  # ombre sous l'objet

    def test_styles_de_decor(self):
        for style in ('parquet', 'beton', 'uni'):
            d = retouche.decor_genere(120, 160, [200, 210, 220], style, 0.6)
            self.assertEqual(d.shape, (120, 160, 3))
            self.assertGreater(d[100].std(), 0.5)


class RenderTests(unittest.TestCase):
    def test_modes_et_erreurs(self):
        img, _ = DecorTests().scene()
        h, w = img.shape[:2]
        zone = np.zeros((h, w), bool)
        zone[80:180, 110:210] = True
        m = data_url(masque(h, w, zone))
        erased = png(render({'image': data_url(img), 'mode': 'erase', 'mask': m}))
        self.assertEqual(erased.shape, img.shape)
        self.assertLess(int(erased[130, 160, 2]) - int(erased[130, 160, 0]), 20)
        decor = png(render({'image': data_url(img), 'mode': 'decor', 'mask': m, 'style': 'beton', 'color': '#E3D5C0', 'horizon': '0.6'}))
        self.assertEqual(decor.shape, img.shape)
        photo = png(render({'image': data_url(img), 'mode': 'decor', 'mask': m, 'decor': data_url(np.full((60, 90, 3), 200, np.uint8))}))
        self.assertEqual(photo.shape, img.shape)
        vide = data_url(masque(h, w, np.zeros((h, w), bool)))
        for bad in (
            {'mode': 'erase', 'mask': vide},
            {'mode': 'decor', 'mask': m, 'style': 'marbre'},
            {'mode': 'decor', 'mask': m, 'color': 'red'},
            {'mode': 'decor', 'mask': m, 'horizon': 'haut'},
            {'mode': 'erase', 'mask': data_url(masque(10, 10, np.ones((10, 10), bool)))},
            {'mode': 'inconnu'},
        ):
            with self.assertRaises(ValueError, msg=str(bad)):
                render({'image': data_url(img), **bad})


if __name__ == '__main__':
    unittest.main(verbosity=2)
