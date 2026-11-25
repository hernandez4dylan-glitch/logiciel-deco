"""Base de la boutique monoposte. Les ventes et mouvements associés sont atomiques."""
from decimal import Decimal, ROUND_HALF_UP
import json, re
import sqlite3

TABLES = {'products','suppliers','stock_movements','sales','expenses','decorators','finishes','product_photos','projects','variants'}
INSERT_FIELDS = {
    'products': {'sku','name','category','supplier_id','purchase_price_ht','sale_price_ttc','pro_price_ttc','stock','low_stock_threshold','image_url'},
    'suppliers': {'name','contact_name','email','phone','lead_time_days'},
    'expenses': {'label','category','amount','expense_date'},
    'decorators': {'name','company','email','phone','discount_percent'},
    'finishes': {'kind','name','reference','color','texture_path','motif_cm','finition','marque','gamme','usage'},
    'product_photos': {'product_id','image_path','cutout_path','label'},
    'projects': {'name','client','notes'},
    'variants': {'project_id','name','base_path','width','height','data'},
}
UPDATE_FIELDS = {
    'products': {'sku','name','category','supplier_id','purchase_price_ht','sale_price_ttc','pro_price_ttc','low_stock_threshold','image_url','cutout_url','published_web','web_synced_at'},
    'expenses': {'label','category','amount','expense_date'},
    'suppliers': {'name','contact_name','email','phone','lead_time_days'},
    'decorators': {'name','company','email','phone','discount_percent'},
    'sales': {'customer_name'},
    'finishes': {'name','reference','color','texture_path','motif_cm','finition','marque','gamme','usage'},
    'product_photos': {'cutout_path','label'},
    'projects': {'name','client','notes'},
    'variants': {'name','data','base_path','width','height'},
}
DELETABLE = {'products','expenses','sales','suppliers','decorators','finishes','product_photos','projects','variants'}
# Filtres d'égalité autorisés dans les lectures (colonne → tables).
FILTRES = {'project_id': {'variants'}, 'product_id': {'product_photos'}, 'kind': {'finishes'}}
BOOLEANS = ('is_pro','published_web')
NUMBERS = ('purchase_price_ht','sale_price_ttc','pro_price_ttc','amount','stock','low_stock_threshold','lead_time_days','motif_cm','width','height')
FACULTATIFS = {'motif_cm'}  # nombres qui peuvent rester vides
FINITIONS = {'peinture','papier','enduit'}
ASPECTS = {'mat','velours','satin','brillant'}  # finition d'une peinture
USAGES = {'mur','plafond','porte','cadre','sol','autre'}
TOUCH = {'projects','variants','finishes'}  # tables avec updated_at

# Migrations additives : jamais de suppression ni de réécriture des données existantes.
MIGRATIONS = {
    2: """
CREATE TABLE IF NOT EXISTS finishes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  kind TEXT NOT NULL CHECK (kind IN ('peinture','papier','enduit')),
  name TEXT NOT NULL,
  reference TEXT,
  color TEXT,
  texture_path TEXT,
  motif_cm NUMERIC,
  finition TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS product_photos (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  cutout_path TEXT,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  client TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_path TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO finishes (kind, name, reference, color, finition) VALUES
  ('peinture', 'Beige mat (exemple)', 'EX-PEI-BEIGE', '#D8C7AE', 'mat'),
  ('peinture', 'Blanc cassé (exemple)', 'EX-PEI-BLANC', '#EFEAE1', 'mat'),
  ('peinture', 'Sauge (exemple)', 'EX-PEI-SAUGE', '#A9B5A0', 'mat'),
  ('peinture', 'Terracotta (exemple)', 'EX-PEI-TERRA', '#C0694A', 'velours'),
  ('enduit', 'Béton ciré gris clair (exemple)', 'EX-END-BETON', '#BDB8B1', 'mat');
""",
    3: """
INSERT INTO finishes (kind, name, reference, color, texture_path, motif_cm, finition) VALUES
  ('papier', 'Feuillage sauge (exemple)', 'EX-PAP-FEUIL', NULL, '/images/motifs/feuillage.png', 53, 'intissé'),
  ('enduit', 'Enduit taloché lin (exemple)', 'EX-END-TALO', '#CDC0B0', '/images/motifs/enduit-taloche.jpg', NULL, 'mat');
""",
    # Teintes et matières comme des produits : marque (fournisseur), gamme, usage
    # (mur, plafond, porte, cadre, sol). Colonnes ajoutées, lignes existantes intactes.
    4: """
ALTER TABLE finishes ADD COLUMN marque TEXT;
ALTER TABLE finishes ADD COLUMN gamme TEXT;
ALTER TABLE finishes ADD COLUMN usage TEXT;
INSERT INTO finishes (kind, name, reference, color, texture_path, motif_cm, finition, usage) VALUES
  ('papier', 'Parquet chêne clair (exemple)', 'EX-SOL-CHENE', NULL, '/images/motifs/parquet-chene.jpg', 140, 'satin', 'sol');
""",
}
VERSION = max(MIGRATIONS)


def migrer(db):
    """Met la base au dernier schéma ; renvoie la version atteinte."""
    v = db.execute('PRAGMA user_version').fetchone()[0]
    for n in sorted(MIGRATIONS):
        if v < n:
            db.executescript('BEGIN IMMEDIATE;\n' + MIGRATIONS[n] + f'\nPRAGMA user_version={n};\nCOMMIT;')
            v = n
    return v

def rows(db,sql,args=()):
    result=[dict(row) for row in db.execute(sql,args)]
    for row in result:
        for key in BOOLEANS:
            if key in row: row[key]=bool(row[key])
    return result

def check(values):
    for field in NUMBERS:
        if field not in values: continue
        if values[field] is None and field in FACULTATIFS: continue
        if values[field] is None or float(values[field])<0: raise ValueError('Valeur négative ou vide')
    if 'discount_percent' in values and not 0<=float(values['discount_percent'])<=100: raise ValueError('Remise invalide')
    for field in ('name','label','sku'):
        if field in values and not str(values[field] or '').strip(): raise ValueError('Champ obligatoire vide')
    if 'kind' in values and values['kind'] not in FINITIONS: raise ValueError('Type de finition inconnu')
    if values.get('kind') == 'peinture' and values.get('finition') not in (None, '') and values['finition'] not in ASPECTS:
        raise ValueError('Finition de peinture inconnue (mat, velours, satin, brillant)')
    if values.get('usage') not in (None, '') and values['usage'] not in USAGES: raise ValueError('Usage inconnu')
    for field in ('marque', 'gamme', 'reference', 'name'):
        if values.get(field) is not None and len(str(values[field])) > 120: raise ValueError('Texte trop long')
    if values.get('color') is not None and not re.fullmatch('#[0-9a-fA-F]{6}',str(values['color'])): raise ValueError('Couleur invalide')
    for field in ('texture_path','image_path','cutout_path','base_path'):
        if values.get(field) is not None and not re.fullmatch(r'(?:/images/(?:products|motifs)/)?[A-Za-z0-9_-]{1,110}\.(?:png|jpe?g|webp|gif|avif)',str(values[field]),re.I):
            raise ValueError('Fichier image invalide')
    if 'data' in values:
        if not isinstance(values['data'],str) or len(values['data'])>2_000_000: raise ValueError('Composition trop volumineuse')
        if not isinstance(json.loads(values['data']),dict): raise ValueError('Composition illisible')

def select(db,table,req):
    sql = 'SELECT * FROM ' + table
    args=[]
    where=[]
    if req.get('since'):
        where.append('created_at >= ?')
        args.append(req['since'])
    for col,val in (req.get('where') or {}).items():
        if table not in FILTRES.get(col,()): raise ValueError('Filtre inconnu')
        where.append(col+' = ?')
        args.append(val)
    if where: sql+=' WHERE '+' AND '.join(where)
    key=req.get('order')
    if key:
        if key not in ('name','created_at','expense_date','updated_at'): raise ValueError('Tri inconnu')
        sql+=' ORDER BY '+key+(' ASC' if req.get('asc') else ' DESC')
    if req.get('limit'):
        sql+=' LIMIT ?'
        args.append(int(req['limit']))
    result=rows(db,sql,args)
    if table=='products':
        suppliers={s['id']:s for s in rows(db,'SELECT id,name FROM suppliers')}
        for p in result: p['supplier']=suppliers.get(p['supplier_id'])
    if table=='sales':
        for sale in result: sale['items']=rows(db,'SELECT * FROM sale_items WHERE sale_id=?',(sale['id'],))
    if table=='stock_movements':
        products={p['id']:p for p in rows(db,'SELECT id,name,sku,purchase_price_ht FROM products')}
        for move in result: move['product']=products.get(move['product_id'])
    return result

def insert(db,table,values):
    if not values or not set(values)<=INSERT_FIELDS.get(table,set()): raise ValueError('Champs invalides')
    check(values)
    names=','.join(values)
    marks=','.join('?' for _ in values)
    record=rows(db,f'INSERT INTO {table} ({names}) VALUES ({marks}) RETURNING *',list(values.values()))[0]
    if table=='products' and record['stock']:
        db.execute("INSERT INTO stock_movements(product_id,quantity,reason) VALUES (?,?, 'Stock initial')",(record['id'],record['stock']))
    return record

def update(db,table,row_id,values):
    allowed=UPDATE_FIELDS.get(table,set())
    if not row_id or not values or not set(values)<=allowed: raise ValueError('Opération inconnue')
    check(values)
    if table=='sales': values={'customer_name':(str(values['customer_name'] or '').strip() or None)}
    fields=','.join(k+'=?' for k in values)
    if table in TOUCH: fields+=",updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    if db.execute(f'UPDATE {table} SET {fields} WHERE id=?',(*values.values(),row_id)).rowcount!=1: raise ValueError('Élément introuvable')
    return rows(db,f'SELECT * FROM {table} WHERE id=?',(row_id,))[0]

def delete(db,table,row_id):
    if table not in DELETABLE or not row_id: raise ValueError('Opération inconnue')
    if table=='sales':
        # Annuler une vente remet les articles en stock (s'ils existent encore).
        for item in rows(db,'SELECT product_id,quantity FROM sale_items WHERE sale_id=? AND product_id IS NOT NULL',(row_id,)):
            if db.execute('SELECT 1 FROM products WHERE id=?',(item['product_id'],)).fetchone():
                adjust(db,item['product_id'],item['quantity'],'Annulation de vente')
    if db.execute(f'DELETE FROM {table} WHERE id=?',(row_id,)).rowcount!=1: raise ValueError('Élément introuvable')
    return None

def adjust(db,prod,qty,reason):
    if type(qty) is not int or not qty: raise ValueError('Quantité invalide')
    row=db.execute('UPDATE products SET stock=stock+? WHERE id=? AND stock+?>=0 RETURNING stock',(qty,prod,qty)).fetchone()
    if row is None: raise ValueError('Stock insuffisant ou article introuvable')
    db.execute('INSERT INTO stock_movements(product_id,quantity,reason) VALUES(?,?,?)',(prod,qty,reason))
    return row['stock']

def sale(db,p):
    items=p['p_items']
    if not items: raise ValueError('Devis vide')
    discount=Decimal(str(p['p_extra_discount']))
    if not 0<=discount<=100: raise ValueError('Remise invalide')
    customer=str(p.get('p_customer') or '').strip() or None
    sale_id=db.execute('INSERT INTO sales(customer_name,is_pro,extra_discount_percent) VALUES(?,?,?) RETURNING id',(customer,bool(p['p_is_pro']),float(discount))).fetchone()[0]
    total=cost=Decimal(0)
    for item in items:
        qty=item['quantity']
        if type(qty) is not int or qty<=0: raise ValueError('Quantité invalide')
        prod=item['product_id']
        adjust(db,prod,-qty,'Vente')
        row=db.execute('SELECT * FROM products WHERE id=?',(prod,)).fetchone()
        unit=Decimal(str(row['pro_price_ttc' if p['p_is_pro'] else 'sale_price_ttc']))
        amount=unit*qty
        total+=amount
        cost+=Decimal(str(row['purchase_price_ht']))*qty
        db.execute('INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price_ttc,unit_cost_ht,line_total_ttc) VALUES(?,?,?,?,?,?,?)',(sale_id,prod,row['name'],qty,float(unit),row['purchase_price_ht'],float(amount)))
    net=(total*(1-discount/100)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
    db.execute('UPDATE sales SET subtotal_ttc=?,total_ttc=?,total_cost_ht=? WHERE id=?',(float(total),float(net),float(cost),sale_id))
    return sale_id

def dispatch(db,req):
    action=req['op']
    if action=='record_sale': return sale(db,req['values'])
    if action=='adjust_stock':
        p=req['values']
        return adjust(db,p['p_product_id'],p['p_delta'],p.get('p_reason','Ajustement'))
    table=req['table']
    if table not in TABLES: raise ValueError('Table inconnue')
    values=req.get('values') or {}
    if action=='select': return select(db,table,req)
    if action=='insert': return insert(db,table,values)
    if action=='update': return update(db,table,req.get('id'),values)
    if action=='delete': return delete(db,table,req.get('id'))
    raise ValueError('Opération inconnue')
