"""Tests de la couche données (base SQLite en mémoire, jamais les données réelles).
Lancement : runtime\\windows\\python.exe local\\tests\\test_data.py"""
import sqlite3, sys, unittest
from pathlib import Path

LOCAL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LOCAL))
from data import dispatch, migrer, VERSION  # noqa: E402

LAMP = 'aaaaaaa1-0000-0000-0000-000000000001'


def fresh():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript((LOCAL / 'init.sql').read_text(encoding='utf-8'))
    migrer(db)
    return db


class DataTests(unittest.TestCase):
    def setUp(self):
        self.db = fresh()

    def run_op(self, **req):
        return dispatch(self.db, req)

    def stock(self, pid):
        return self.db.execute('SELECT stock FROM products WHERE id=?', (pid,)).fetchone()[0]

    def test_booleans_are_real_booleans(self):
        products = self.run_op(table='products', op='select')
        self.assertTrue(all(isinstance(p['published_web'], bool) for p in products))
        sid = self.run_op(op='record_sale', values={'p_items': [{'product_id': LAMP, 'quantity': 1}], 'p_is_pro': False, 'p_extra_discount': 0, 'p_customer': '  '})
        sale = [s for s in self.run_op(table='sales', op='select') if s['id'] == sid][0]
        self.assertIs(sale['is_pro'], False)
        self.assertIsNone(sale['customer_name'])

    def test_product_crud(self):
        p = self.run_op(table='products', op='insert', values={'sku': 'TST-1', 'name': 'Essai', 'category': 'Textile', 'purchase_price_ht': 1, 'sale_price_ttc': 3, 'pro_price_ttc': 2, 'stock': 4, 'low_stock_threshold': 1})
        self.assertEqual(p['stock'], 4)
        updated = self.run_op(table='products', op='update', id=p['id'], values={'name': 'Essai 2', 'sale_price_ttc': 5})
        self.assertEqual((updated['name'], updated['sale_price_ttc']), ('Essai 2', 5))
        with self.assertRaises(ValueError):
            self.run_op(table='products', op='update', id=p['id'], values={'stock': 99})
        with self.assertRaises(ValueError):
            self.run_op(table='products', op='update', id=p['id'], values={'sale_price_ttc': -1})
        self.run_op(table='products', op='delete', id=p['id'])
        self.assertFalse(self.db.execute('SELECT 1 FROM products WHERE id=?', (p['id'],)).fetchone())
        self.assertFalse(self.db.execute('SELECT 1 FROM stock_movements WHERE product_id=?', (p['id'],)).fetchone())

    def test_sale_update_and_cancel_restocks(self):
        before = self.stock(LAMP)
        sid = self.run_op(op='record_sale', values={'p_items': [{'product_id': LAMP, 'quantity': 2}], 'p_is_pro': True, 'p_extra_discount': 10, 'p_customer': 'Mme A'})
        self.assertEqual(self.stock(LAMP), before - 2)
        total = self.db.execute('SELECT total_ttc FROM sales WHERE id=?', (sid,)).fetchone()[0]
        self.assertAlmostEqual(total, 109 * 2 * 0.9)
        self.assertEqual(self.run_op(table='sales', op='update', id=sid, values={'customer_name': 'M. B'})['customer_name'], 'M. B')
        self.run_op(table='sales', op='delete', id=sid)
        self.assertEqual(self.stock(LAMP), before)
        self.assertFalse(self.db.execute('SELECT 1 FROM sale_items WHERE sale_id=?', (sid,)).fetchone())

    def test_cancel_sale_of_deleted_product(self):
        sid = self.run_op(op='record_sale', values={'p_items': [{'product_id': LAMP, 'quantity': 1}], 'p_is_pro': False, 'p_extra_discount': 0, 'p_customer': None})
        self.run_op(table='products', op='delete', id=LAMP)
        self.run_op(table='sales', op='delete', id=sid)

    def test_sale_rejects_insufficient_stock(self):
        with self.assertRaises(ValueError):
            self.run_op(op='record_sale', values={'p_items': [{'product_id': LAMP, 'quantity': 999}], 'p_is_pro': False, 'p_extra_discount': 0, 'p_customer': ''})

    def test_expense_crud(self):
        e = self.run_op(table='expenses', op='insert', values={'expense_date': '2026-11-02', 'label': 'Encre', 'category': 'Frais divers', 'amount': 12.5})
        u = self.run_op(table='expenses', op='update', id=e['id'], values={'amount': 15, 'label': 'Encre noire', 'category': 'Dépenses magasin', 'expense_date': '2026-11-03'})
        self.assertEqual((u['amount'], u['label'], u['category']), (15, 'Encre noire', 'Dépenses magasin'))
        with self.assertRaises(ValueError):
            self.run_op(table='expenses', op='update', id=e['id'], values={'label': '  '})
        self.run_op(table='expenses', op='delete', id=e['id'])
        with self.assertRaises(ValueError):
            self.run_op(table='expenses', op='delete', id=e['id'])

    def test_migration_conserve_les_donnees(self):
        old = sqlite3.connect(':memory:')
        old.row_factory = sqlite3.Row
        old.execute('PRAGMA foreign_keys=ON')
        old.executescript((LOCAL / 'init.sql').read_text(encoding='utf-8'))
        old.execute("UPDATE products SET name='Lampe modifiée', cutout_url='cutout-x.png' WHERE id=?", (LAMP,))
        old.commit()
        avant = [tuple(r) for r in old.execute('SELECT * FROM products ORDER BY id')]
        self.assertEqual(migrer(old), VERSION)
        self.assertEqual(migrer(old), VERSION)  # idempotent
        self.assertEqual(avant, [tuple(r) for r in old.execute('SELECT * FROM products ORDER BY id')])
        noms = {r[0] for r in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({'finishes', 'product_photos', 'projects', 'variants'} <= noms)
        self.assertEqual(old.execute('SELECT count(*) FROM finishes').fetchone()[0], 8)
        self.assertTrue({'prix_ttc', 'unite', 'm2_par_unite', 'couches'} <= {r[1] for r in old.execute('PRAGMA table_info(finishes)')})
        self.assertEqual(old.execute("SELECT count(*) FROM finishes WHERE kind='papier'").fetchone()[0], 2)
        self.assertEqual(old.execute("SELECT count(*) FROM finishes WHERE usage='sol'").fetchone()[0], 1)
        cols = {r[1] for r in old.execute('PRAGMA table_info(finishes)')}
        self.assertTrue({'marque', 'gamme', 'usage', 'finition'} <= cols)

    def test_migration_4_depuis_la_version_3(self):
        # Base déjà en version 3 avec une teinte saisie : elle est conservée telle quelle.
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.executescript((LOCAL / 'init.sql').read_text(encoding='utf-8'))
        from data import MIGRATIONS
        for n in (2, 3):
            db.executescript(MIGRATIONS[n] + f'\nPRAGMA user_version={n};')
        db.execute("INSERT INTO finishes (kind, name, reference, color, finition) VALUES ('peinture','Ma teinte','R-1','#112233','mat')")
        db.commit()
        avant = [tuple(r) for r in db.execute('SELECT * FROM finishes ORDER BY id')]
        self.assertEqual(migrer(db), VERSION)
        apres = [tuple(r)[:len(avant[0])] for r in db.execute('SELECT * FROM finishes WHERE reference != ? ORDER BY id', ('EX-SOL-CHENE',))]
        self.assertEqual(avant, apres)

    def test_teintes_et_matieres(self):
        # Valeurs telles que les envoie le formulaire (motif vide, sans texture).
        t = self.run_op(table='finishes', op='insert', values={'kind': 'peinture', 'name': 'Lin 204', 'reference': 'MAG-204', 'color': '#D9CBB4', 'texture_path': None, 'motif_cm': None, 'finition': 'mat'})
        with self.assertRaises(ValueError):
            self.run_op(table='finishes', op='insert', values={'kind': 'papier', 'name': 'x', 'motif_cm': -3})
        u = self.run_op(table='finishes', op='update', id=t['id'], values={'color': '#D0C0A8', 'reference': 'MAG-205'})
        self.assertEqual((u['color'], u['reference']), ('#D0C0A8', 'MAG-205'))
        for bad in ({'kind': 'vernis', 'name': 'x'}, {'kind': 'peinture', 'name': 'x', 'color': 'beige'},
                    {'kind': 'papier', 'name': 'x', 'texture_path': '../boutique.sqlite3'}):
            with self.assertRaises(ValueError):
                self.run_op(table='finishes', op='insert', values=bad)
        papiers = self.run_op(table='finishes', op='select', where={'kind': 'papier'})
        self.assertEqual(sorted(p['texture_path'] for p in papiers), ['/images/motifs/feuillage.png', '/images/motifs/parquet-chene.jpg'])
        # Peinture d'un fournisseur : marque, gamme, finition, usage.
        lg = self.run_op(table='finishes', op='insert', values={'kind': 'peinture', 'name': 'Teinte essai', 'reference': 'REF-1',
                         'color': '#8A9A8C', 'finition': 'velours', 'marque': 'Marque essai', 'gamme': 'Intérieur', 'usage': 'porte'})
        self.assertEqual((lg['marque'], lg['finition'], lg['usage']), ('Marque essai', 'velours', 'porte'))
        for bad in ({'kind': 'peinture', 'name': 'x', 'finition': 'laquée'}, {'kind': 'peinture', 'name': 'x', 'usage': 'toit'},
                    {'kind': 'peinture', 'name': 'x', 'marque': 'm' * 200}):
            with self.assertRaises(ValueError):
                self.run_op(table='finishes', op='insert', values=bad)

    def test_projets_et_variantes(self):
        p = self.run_op(table='projects', op='insert', values={'name': 'Salon Martin', 'client': 'M. Martin'})
        v = self.run_op(table='variants', op='insert', values={'project_id': p['id'], 'name': 'A', 'base_path': 'base-1.jpg', 'width': 1600, 'height': 900, 'data': '{"items": []}'})
        self.run_op(table='variants', op='insert', values={'project_id': p['id'], 'name': 'B', 'base_path': 'base-1.jpg', 'width': 1600, 'height': 900, 'data': '{}'})
        self.assertEqual(len(self.run_op(table='variants', op='select', where={'project_id': p['id']})), 2)
        u = self.run_op(table='variants', op='update', id=v['id'], values={'data': '{"items": [1]}'})
        self.assertGreaterEqual(u['updated_at'], v['updated_at'])
        with self.assertRaises(ValueError):
            self.run_op(table='variants', op='update', id=v['id'], values={'data': 'pas du json'})
        with self.assertRaises(ValueError):
            self.run_op(table='variants', op='select', where={'name': 'A'})
        self.run_op(table='projects', op='delete', id=p['id'])
        self.assertEqual(self.run_op(table='variants', op='select', where={'project_id': p['id']}), [])

    def test_photos_article(self):
        ph = self.run_op(table='product_photos', op='insert', values={'product_id': LAMP, 'image_path': 'lampe-2.jpg', 'label': 'Vue de face'})
        self.run_op(table='product_photos', op='update', id=ph['id'], values={'cutout_path': 'cutout-lampe-2.png'})
        self.assertEqual(self.run_op(table='product_photos', op='select', where={'product_id': LAMP})[0]['cutout_path'], 'cutout-lampe-2.png')
        self.run_op(table='products', op='delete', id=LAMP)
        self.assertEqual(self.run_op(table='product_photos', op='select', where={'product_id': LAMP}), [])

    def test_unknown_table_and_fields_rejected(self):
        with self.assertRaises(ValueError):
            self.run_op(table='sqlite_master', op='select')
        with self.assertRaises(ValueError):
            self.run_op(table='stock_movements', op='delete', id='x')
        with self.assertRaises(ValueError):
            self.run_op(table='products', op='update', id=LAMP, values={'id; DROP TABLE products': 1})


if __name__ == '__main__':
    unittest.main(verbosity=2)
