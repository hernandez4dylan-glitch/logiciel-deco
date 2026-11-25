CREATE TABLE suppliers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  lead_time_days integer NOT NULL DEFAULT 7,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE products (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('Luminaire','Mobilier','Textile','Objet déco')),
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_price_ht numeric(10,2) NOT NULL DEFAULT 0,
  sale_price_ttc numeric(10,2) NOT NULL DEFAULT 0,
  pro_price_ttc numeric(10,2) NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 3,
  image_url text,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  reason text NOT NULL DEFAULT 'Ajustement',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sales (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  customer_name text,
  is_pro boolean NOT NULL DEFAULT false,
  extra_discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  subtotal_ttc numeric(10,2) NOT NULL DEFAULT 0,
  total_ttc numeric(10,2) NOT NULL DEFAULT 0,
  total_cost_ht numeric(10,2) NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sale_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_ttc numeric(10,2) NOT NULL,
  unit_cost_ht numeric(10,2) NOT NULL DEFAULT 0,
  line_total_ttc numeric(10,2) NOT NULL
);
CREATE TABLE expenses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  expense_date date NOT NULL DEFAULT current_date,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('Frais généraux','Frais divers','Dépenses magasin')),
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO suppliers (id, name, contact_name, email, phone, lead_time_days) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Atelier Terre & Feu', 'Claire Moreau', 'commandes@terre-et-feu.fr', '04 75 12 34 56', 10),
  ('22222222-2222-2222-2222-222222222222', 'Maison Lin du Nord', 'Julien Vasseur', 'pro@lindunord.fr', '03 20 45 67 89', 7),
  ('33333333-3333-3333-3333-333333333333', 'Bois & Forme Ébénisterie', 'Sofia Martins', 'contact@boisetforme.fr', '05 56 78 90 12', 21);
INSERT INTO products (id, sku, name, category, supplier_id, purchase_price_ht, sale_price_ttc, pro_price_ttc, stock, low_stock_threshold, image_url) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001', 'LUM-CER-001', 'Lampe à poser en céramique sable', 'Luminaire', '11111111-1111-1111-1111-111111111111', 42.00, 129.00, 109.00, 8, 3, '/images/products/lampe-ceramique.jpg'),
  ('aaaaaaa1-0000-0000-0000-000000000002', 'MOB-BOU-002', 'Fauteuil bouclette écru', 'Mobilier', '33333333-3333-3333-3333-333333333333', 210.00, 549.00, 469.00, 2, 2, '/images/products/fauteuil-bouclette.jpg'),
  ('aaaaaaa1-0000-0000-0000-000000000003', 'DEC-GRE-003', 'Vase en grès émaillé terracotta', 'Objet déco', '11111111-1111-1111-1111-111111111111', 18.50, 59.00, 49.00, 14, 4, '/images/products/vase-gres.jpg'),
  ('aaaaaaa1-0000-0000-0000-000000000004', 'TEX-LIN-004', 'Plaid en lin lavé sauge', 'Textile', '22222222-2222-2222-2222-222222222222', 24.00, 79.00, 65.00, 3, 4, '/images/products/plaid-lin.jpg'),
  ('aaaaaaa1-0000-0000-0000-000000000005', 'MOB-CHE-005', 'Table d''appoint en chêne massif', 'Mobilier', '33333333-3333-3333-3333-333333333333', 95.00, 259.00, 219.00, 5, 2, '/images/products/table-chene.jpg'),
  ('aaaaaaa1-0000-0000-0000-000000000006', 'LUM-ROT-006', 'Suspension en rotin naturel', 'Luminaire', '22222222-2222-2222-2222-222222222222', 36.00, 109.00, 92.00, 1, 2, '/images/products/suspension-rotin.jpg');
INSERT INTO stock_movements (product_id, quantity, reason, created_at) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000003', 10, 'Réception fournisseur', strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days')),
  ('aaaaaaa1-0000-0000-0000-000000000001', 6, 'Réception fournisseur', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days')),
  ('aaaaaaa1-0000-0000-0000-000000000004', -2, 'Vente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),
  ('aaaaaaa1-0000-0000-0000-000000000002', -1, 'Vente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),
  ('aaaaaaa1-0000-0000-0000-000000000003', -2, 'Vente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'));
INSERT INTO expenses (expense_date, label, category, amount) VALUES
  (date('now','-10 days'), 'Loyer de la boutique', 'Frais généraux', 1200.00),
  (date('now','-7 days'), 'Électricité', 'Frais généraux', 145.00),
  (date('now','-4 days'), 'Papier kraft & rubans d''emballage', 'Dépenses magasin', 38.50),
  (date('now','-1 days'), 'Frais de livraison client', 'Frais divers', 25.00);
CREATE TABLE decorators (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name text NOT NULL,
  company text,
  email text,
  phone text,
  discount_percent numeric NOT NULL DEFAULT 15,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
ALTER TABLE products ADD COLUMN published_web boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN web_synced_at TEXT;

INSERT INTO decorators (name, company, email, phone, discount_percent) VALUES
  ('Camille Laurent', 'Studio Camille L.', 'camille@studio-cl.fr', '06 12 34 56 78', 15),
  ('Hugo Bernard', 'Atelier Intérieurs HB', 'hugo@interieurs-hb.fr', '06 98 76 54 32', 20),
  ('Inès Duval', 'Duval Architecture', 'ines@duval-archi.fr', '07 45 23 11 90', 12);
UPDATE products SET published_web = true, web_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE sku IN ('LUM-CER-001','DEC-GRE-003','MOB-CHE-005');
ALTER TABLE products ADD COLUMN cutout_url text;