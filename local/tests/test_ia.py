"""Tests de l'IA locale : analyse de la pièce et optimisation finale.
Les tests qui exécutent les modèles sont ignorés s'ils ne sont pas installés
(local/modeles, livrés dans le ZIP Windows)."""
import base64, sys, unittest
from pathlib import Path

LOCAL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LOCAL))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import analyse, optimisation, photo  # noqa: E402

ESSAI = LOCAL.parent / 'Essai_photo'


def data_url(img):
    ok, buf = cv2.imencode('.png', img)
    return 'data:image/png;base64,' + base64.b64encode(buf.tobytes()).decode()


class DecoupeTests(unittest.TestCase):
    def test_angle_de_piece_dans_un_profil_en_v(self):
        x = np.linspace(0, 1, 400)
        y = np.where(x < 0.4, 1 - x, 0.6 + 0.5 * (x - 0.4))
        coupes = analyse._segments(x, y + np.random.default_rng(0).normal(0, 0.003, x.size))
        self.assertEqual(len(coupes), 1)
        self.assertAlmostEqual(coupes[0], 0.4, delta=0.03)

    def test_mur_plan_non_decoupe(self):
        x = np.linspace(0, 1, 400)
        self.assertEqual(analyse._segments(x, 0.2 + 0.5 * x + np.random.default_rng(1).normal(0, 0.003, x.size)), [])


class PlintheTests(unittest.TestCase):
    def test_plinthe_droite_trouvee_pied_arrondi_ignore(self):
        H, W = 400, 600
        img = np.full((H, W, 3), (150, 170, 190), np.uint8)       # mur
        img[300:] = (90, 110, 130)                                 # sol
        img[284:300, :] = (235, 235, 235)                          # plinthe blanche droite
        cv2.ellipse(img, (300, 300), (80, 30), 0, 180, 360, (40, 40, 40), -1)  # pied arrondi d'un meuble
        sol = np.zeros((H, W), np.float32)
        sol[300:] = 1
        pl = analyse._plinthes(img, sol, np.zeros((H, W), bool)) > 0.5
        self.assertGreater(pl[286:298, 20:200].mean(), 0.8, 'plinthe trouvée')
        self.assertLess(pl[200:280, :].mean(), 0.01, 'le mur reste un mur')

    def test_plinthe_interrompue_raccordee_jusqu_au_bord(self):
        H, W = 400, 600
        img = np.full((H, W, 3), (150, 170, 190), np.uint8)       # mur
        img[300:] = (90, 110, 130)                                 # sol
        img[284:300, :] = (235, 235, 235)                          # plinthe
        img[284:300, 280:320] = (205, 205, 205)                    # reflet : arête brouillée
        img[278:300, 280:320] = (205, 205, 205)
        sol = np.zeros((H, W), np.float32)
        sol[300:] = 1
        mur = np.zeros((H, W), bool)
        mur[:300] = True
        pl = analyse._plinthes(img, sol, np.zeros((H, W), bool), mur) > 0.5
        self.assertGreater(pl[288:298, :].mean(), 0.95, 'plinthe continue, raccordée et prolongée')
        self.assertLess(pl[200:276, :].mean(), 0.01)


class FlouTests(unittest.TestCase):
    def test_grand_flou_reduit_fidele(self):
        import finitions
        rng = np.random.default_rng(0)
        x = cv2.GaussianBlur(rng.random((900, 1200)).astype(np.float32), (0, 0), 6)
        x[:, 600:] += 0.5
        exact = cv2.GaussianBlur(x, (0, 0), 30)
        self.assertLess(float(np.abs(finitions._flou(x, 30) - exact)[60:-60, 60:-60].max()), 0.02)


class OptimisationSansModeleTests(unittest.TestCase):
    def test_planificateur_lcm(self):
        ts = optimisation.pas_lcm(3, 0.45)
        self.assertEqual(len(ts), 3)
        self.assertTrue(all(a > b for a, b in zip(ts, ts[1:])))
        self.assertLess(ts[0], 460)  # force 0,45 : on part d'une image peu bruitée

    def test_zones_utiles_anneau_et_ombre(self):
        a = np.zeros((300, 300), np.float32)
        a[100:200, 120:180] = 1
        ombre = np.zeros_like(a)
        ombre[200:210, 110:190] = 0.5
        z = optimisation.zones_utiles(a, ombre)
        self.assertEqual(z[150, 150], 0, "intérieur de l'article jamais régénéré")
        self.assertEqual(z[150, 119], 1, 'contour extérieur retouché')
        self.assertEqual(z[205, 150], 1, 'ombre de contact retouchée')
        self.assertEqual(z[20, 20], 0, 'reste du montage conservé')

    def test_sans_article_refuse(self):
        img = np.full((64, 64, 3), 128, np.uint8)
        if not optimisation.disponible():
            self.skipTest('modèle absent')
        with self.assertRaises(ValueError):
            photo.render({'mode': 'optimiser', 'image': data_url(img), 'articles': data_url(np.zeros((64, 64), np.uint8))})


@unittest.skipUnless(analyse.disponible(), 'modèles d’analyse absents')
class AnalyseTests(unittest.TestCase):
    def test_piece_en_angle_deux_pans_sol_plafond(self):
        img = cv2.imread(str(ESSAI / 'piece-angle.jpg'))
        self.assertIsNotNone(img, 'image d’essai manquante (local/tests/generer_piece_angle.py)')
        r = analyse.analyser(img)
        surfaces = [z['surface'] for z in r['zones']]
        self.assertGreaterEqual(surfaces.count('mur'), 2, 'les deux murs en angle sont séparés')
        self.assertIn('sol', surfaces)
        self.assertIn('plafond', surfaces)
        # Le fauteuil du premier plan et la fenêtre ne sont pas des murs.
        murs = np.maximum.reduce([z['masque'] for z in r['zones'] if z['surface'] == 'mur'])
        self.assertLess(murs[850:950, 950:1350].mean(), 0.05, 'fauteuil exclu')
        self.assertLess(murs[350:600, 200:380].mean(), 0.1, 'vitrage exclu')
        self.assertLess(r['temps']['total'], 90)

    def test_mode_analyse_json(self):
        img = cv2.resize(cv2.imread(str(ESSAI / 'rendu-de-reference.jpg')), (640, 407))
        r = photo.render({'mode': 'analyse', 'image': data_url(img)})
        self.assertIsInstance(r, dict)
        self.assertTrue(any(z['surface'] == 'mur' for z in r['zones']))
        self.assertTrue(r['zones'][0]['masque'].startswith('data:image/png;base64,'))


@unittest.skipUnless(optimisation.disponible(), 'modèle d’optimisation absent')
class GenerationTests(unittest.TestCase):
    def test_generation_reduite_garde_le_reste(self):
        img = np.full((128, 128, 3), 170, np.uint8)
        img[40:100, 50:80] = (40, 90, 160)
        m = np.zeros((128, 128), np.float32)
        m[36:104, 46:84] = 1
        out = optimisation.generer(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), m, etapes=1, force=0.3)
        self.assertEqual(out.shape, (128, 128, 3))
        self.assertGreater(out.std(), 5)


if __name__ == '__main__':
    unittest.main(verbosity=2)
