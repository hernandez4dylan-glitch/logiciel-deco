"""Rendu réaliste IA : recalage couleur/détail (sans le modèle) et suivi des tâches."""
import json, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import rendu_ia
import rendu_ia_taches as ria


class RecalageTests(unittest.TestCase):
    def setUp(self):
        H, W = 240, 320
        self.montage = np.full((H, W, 3), (120, 150, 135), np.uint8)  # vert sauge (BGR)
        self.zones = np.zeros((H, W), np.float32)
        self.zones[:, :200] = 1
        self.objets = np.zeros((H, W), np.float32)
        self.objets[150:220, 230:290] = 1
        self.montage[150:220, 230:290] = (200, 220, 230)

    def test_la_teinte_du_nuancier_est_retrouvee(self):
        gen = self.montage.astype(np.float32).copy()
        gen[:, :200] = (150, 165, 175)  # l'IA a dérivé vers le grège
        out = rendu_ia.recaler(gen, self.montage, self.zones, self.objets)
        lab = lambda c: cv2.cvtColor(np.uint8([[c]]), cv2.COLOR_BGR2LAB)[0, 0].astype(float)
        moyen = np.clip(out[40:200, 20:180].reshape(-1, 3).mean(0), 0, 255)
        self.assertLess(np.linalg.norm(lab(moyen)[1:] - lab(self.montage[0, 0])[1:]), 3.0)

    def test_autour_des_articles_pas_de_halo_clair(self):
        gen = self.montage.astype(np.float32).copy()
        gen[140:230, 215:305] += 60  # halo clair inventé autour de l'article
        gen[225:235, 230:290] -= 50  # ombre de contact : gardée
        pourtour = cv2.dilate(self.objets, np.ones((31, 31), np.uint8))
        out = rendu_ia.recaler(gen, self.montage, np.zeros_like(self.zones), self.objets, pourtour)
        self.assertLess(out[145, 300].mean(), self.montage[145, 300].mean() + 6)
        self.assertLess(out[229, 260].mean(), self.montage[229, 260].mean() - 10)

    def test_consigne_selon_les_finitions(self):
        c = rendu_ia.consigne([{'surface': 'sol', 'nom': 'Béton ciré'}, {'surface': 'mur', 'kind': 'papier'}])
        self.assertIn('concrete floor', c)
        self.assertIn('wallpaper', c)


class TachesTests(unittest.TestCase):
    def test_module_absent_message_clair(self):
        with mock.patch.object(ria, 'disponible', return_value=False):
            with self.assertRaisesRegex(ValueError, 'Module de rendu IA absent'):
                ria.lancer({})

    def test_image_invalide_refusee_et_dossier_nettoye(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(ria, 'disponible', return_value=True), \
                mock.patch.object(ria, 'TRAVAIL', Path(tmp)):
            with self.assertRaisesRegex(ValueError, 'invalide'):
                ria.lancer({'montage': 'pas une image'})
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_fin_de_rendu_range_l_image_dans_les_photos(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, photos = Path(tmp) / 'tache', Path(tmp) / 'photos'
            d.mkdir(); photos.mkdir()
            (d / 'resultat.jpg').write_bytes(b'jpeg')
            (d / 'etat.json').write_text(json.dumps({'progression': 1, 'message': 'Terminé', 'duree': 80}))
            proc = mock.Mock(); proc.poll.return_value = 0; proc.returncode = 0
            ria._TACHES['x' * 32] = {'proc': proc, 'dossier': d, 'image': None}
            try:
                e = ria.etat('x' * 32, photos)
                self.assertEqual(e['image'], f"rendu-ia-{'x' * 32}.jpg")
                self.assertTrue((photos / e['image']).is_file())
                self.assertFalse(d.exists())
                self.assertEqual(ria.etat('x' * 32, photos)['image'], e['image'])  # second appel : même réponse
            finally:
                ria._TACHES.pop('x' * 32, None)


if __name__ == '__main__':
    unittest.main()
