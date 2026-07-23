PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'closed')) DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_phone_unique
ON people(phone)
WHERE phone IS NOT NULL AND phone <> '';

CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);

CREATE TABLE IF NOT EXISTS attendances (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  check_in_at TEXT NOT NULL,
  check_out_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('present', 'left', 'cancelled')) DEFAULT 'present',
  created_at TEXT NOT NULL,
  UNIQUE(event_id, person_id),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_attendances_event ON attendances(event_id);
CREATE INDEX IF NOT EXISTS idx_attendances_person ON attendances(person_id);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  default_price_cents INTEGER NOT NULL CHECK (default_price_cents >= 0),
  requires_preparation INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category, name);

CREATE TABLE IF NOT EXISTS event_products (
  event_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  available INTEGER NOT NULL DEFAULT 1,
  stock_initial INTEGER,
  stock_sold INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(event_id, product_id),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS tabs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  attendance_id TEXT NOT NULL UNIQUE,
  number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'cancelled')) DEFAULT 'open',
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, number),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(attendance_id) REFERENCES attendances(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tabs_event_status ON tabs(event_id, status);

CREATE TABLE IF NOT EXISTS tab_items (
  id TEXT PRIMARY KEY,
  tab_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  total_price_cents INTEGER NOT NULL CHECK (total_price_cents >= 0),
  preparation_status TEXT CHECK (
    preparation_status IS NULL OR
    preparation_status IN ('waiting', 'preparing', 'ready', 'delivered', 'cancelled')
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY(tab_id) REFERENCES tabs(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tab_items_tab ON tab_items(tab_id);
CREATE INDEX IF NOT EXISTS idx_tab_items_preparation ON tab_items(preparation_status);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tab_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('pix', 'debit', 'credit', 'cash', 'courtesy')),
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(tab_id) REFERENCES tabs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payments_tab ON payments(tab_id);

INSERT OR IGNORE INTO events
  (id, name, event_date, starts_at, ends_at, status, created_at, updated_at)
VALUES
  ('event_pilot', 'Mesão do Amor — Evento Piloto', '2026-07-18', '14:00', '22:00', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO products
  (id, name, category, default_price_cents, requires_preparation, active, created_at, updated_at)
VALUES
  ('prod_001', 'Adicional Monster Combo', 'Combos', 600, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_002', 'Água sem gás', 'Bebidas', 350, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_003', 'Alela Perigosa', 'Cartas', 2990, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_004', 'Bitterblosom', 'Cartas', 4790, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_005', 'Bitterblossom com Monster', 'Combos', 5390, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_006', 'Coca Normal', 'Bebidas', 790, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_007', 'Coca Zero', 'Bebidas', 790, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_008', 'Deckbox - Verde - Central', 'Deckboxes', 3190, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_009', 'Deckbox - Azul - Central', 'Deckboxes', 3190, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_010', 'Deckbox - Amarelo - Central', 'Deckboxes', 3190, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_011', 'Deckbox - Vermelho - VIPER', 'Deckboxes', 3490, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_012', 'Deckbox - Preta - VIPER', 'Deckboxes', 3490, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_013', 'Deckbox - Rosa - Central', 'Deckboxes', 3190, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_014', 'Deckbox - Rosa - VIPER', 'Deckboxes', 3490, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_015', 'Deckbox - Roxo - Central', 'Deckboxes', 3190, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_016', 'Deckbox - Turquesa - VIPER', 'Deckboxes', 3490, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_017', 'Deckbox - Verde - VIPER', 'Deckboxes', 3490, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_018', 'Elfo de Llanowar', 'Cartas', 2720, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_019', 'Elfo Místico', 'Cartas', 3290, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_020', 'Heineken', 'Bebidas', 1200, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_021', 'Itubaina', 'Bebidas', 790, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_022', 'Monster Manga', 'Bebidas', 1400, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_023', 'Monster Normal', 'Bebidas', 1400, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_024', 'Oona', 'Cartas', 4690, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_025', 'Oona com Monster', 'Combos', 5290, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_026', 'Pepsi Black', 'Bebidas', 790, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_027', 'Porção Batata', 'Comidas', 1500, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_028', 'Porção de Nuggets', 'Comidas', 1800, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_029', 'Selvala', 'Cartas', 4590, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_030', 'Shield - Amarelo Solar - Viper', 'Shields', 6500, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_031', 'Shield - Azul - GEM', 'Shields', 6990, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_032', 'Shield - Azul Sereno - Viper', 'Shields', 6990, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_033', 'Shield - Laranja Ardente - Viper', 'Shields', 6500, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_034', 'Shield - Menta Gélida - Viper', 'Shields', 6500, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_035', 'Shield - Outfit', 'Shields', 6000, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_036', 'Shield - Perfect Fit - GEM', 'Shields', 2490, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_037', 'Shield - Perfect Fit Envelope - Central', 'Shields', 5290, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_038', 'Shield - Rosa Cereja - Viper', 'Shields', 6990, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_039', 'Shield - Verde Letal - Viper', 'Shields', 6500, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_040', 'Dual Matte - Gold - GEM', 'Shields', 8250, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_041', 'Skol', 'Bebidas', 800, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_042', 'Talion', 'Cartas', 3590, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_043', 'Top loader fit - Central', 'Acessórios', 1990, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_044', 'Tribo de Llanowar', 'Cartas', 4390, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_045', 'Booster Marvel', 'Boosters', 3990, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_046', 'Ice', 'Bebidas', 1190, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_047', 'Ice apple', 'Bebidas', 1190, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_048', 'Dados central +/-', 'Acessórios', 3500, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod_049', 'Vegetariano - scapeshift', 'Comidas', 5990, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO event_products
  (event_id, product_id, price_cents, available, stock_initial, stock_sold)
VALUES
  ('event_pilot', 'prod_001', 600, 1, NULL, 0),
  ('event_pilot', 'prod_002', 350, 1, NULL, 0),
  ('event_pilot', 'prod_003', 2990, 1, NULL, 0),
  ('event_pilot', 'prod_004', 4790, 1, NULL, 0),
  ('event_pilot', 'prod_005', 5390, 1, NULL, 0),
  ('event_pilot', 'prod_006', 790, 1, NULL, 0),
  ('event_pilot', 'prod_007', 790, 1, NULL, 0),
  ('event_pilot', 'prod_008', 3190, 1, NULL, 0),
  ('event_pilot', 'prod_009', 3190, 1, NULL, 0),
  ('event_pilot', 'prod_010', 3190, 1, NULL, 0),
  ('event_pilot', 'prod_011', 3490, 1, NULL, 0),
  ('event_pilot', 'prod_012', 3490, 1, NULL, 0),
  ('event_pilot', 'prod_013', 3190, 1, NULL, 0),
  ('event_pilot', 'prod_014', 3490, 1, NULL, 0),
  ('event_pilot', 'prod_015', 3190, 1, NULL, 0),
  ('event_pilot', 'prod_016', 3490, 1, NULL, 0),
  ('event_pilot', 'prod_017', 3490, 1, NULL, 0),
  ('event_pilot', 'prod_018', 2720, 1, NULL, 0),
  ('event_pilot', 'prod_019', 3290, 1, NULL, 0),
  ('event_pilot', 'prod_020', 1200, 1, NULL, 0),
  ('event_pilot', 'prod_021', 790, 1, NULL, 0),
  ('event_pilot', 'prod_022', 1400, 1, NULL, 0),
  ('event_pilot', 'prod_023', 1400, 1, NULL, 0),
  ('event_pilot', 'prod_024', 4690, 1, NULL, 0),
  ('event_pilot', 'prod_025', 5290, 1, NULL, 0),
  ('event_pilot', 'prod_026', 790, 1, NULL, 0),
  ('event_pilot', 'prod_027', 1500, 1, NULL, 0),
  ('event_pilot', 'prod_028', 1800, 1, NULL, 0),
  ('event_pilot', 'prod_029', 4590, 1, NULL, 0),
  ('event_pilot', 'prod_030', 6500, 1, NULL, 0),
  ('event_pilot', 'prod_031', 6990, 1, NULL, 0),
  ('event_pilot', 'prod_032', 6990, 1, NULL, 0),
  ('event_pilot', 'prod_033', 6500, 1, NULL, 0),
  ('event_pilot', 'prod_034', 6500, 1, NULL, 0),
  ('event_pilot', 'prod_035', 6000, 1, NULL, 0),
  ('event_pilot', 'prod_036', 2490, 1, NULL, 0),
  ('event_pilot', 'prod_037', 5290, 1, NULL, 0),
  ('event_pilot', 'prod_038', 6990, 1, NULL, 0),
  ('event_pilot', 'prod_039', 6500, 1, NULL, 0),
  ('event_pilot', 'prod_040', 8250, 1, NULL, 0),
  ('event_pilot', 'prod_041', 800, 1, NULL, 0),
  ('event_pilot', 'prod_042', 3590, 1, NULL, 0),
  ('event_pilot', 'prod_043', 1990, 1, NULL, 0),
  ('event_pilot', 'prod_044', 4390, 1, NULL, 0),
  ('event_pilot', 'prod_045', 3990, 1, NULL, 0),
  ('event_pilot', 'prod_046', 1190, 1, NULL, 0),
  ('event_pilot', 'prod_047', 1190, 1, NULL, 0),
  ('event_pilot', 'prod_048', 3500, 1, NULL, 0),
  ('event_pilot', 'prod_049', 5990, 1, NULL, 0);

-- ================================================================
-- Cartas avulsas (fluxo simplificado com foto temporária no D1)
-- ================================================================

CREATE TABLE IF NOT EXISTS card_folders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_folders_active
ON card_folders(active, sort_order, name);

CREATE TABLE IF NOT EXISTS card_orders (
  id TEXT PRIMARY KEY,
  tab_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  folder_code_snapshot TEXT NOT NULL,
  folder_name_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'cancelled')),
  card_count INTEGER NOT NULL DEFAULT 0 CHECK (card_count >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  photo_data_url TEXT,
  photo_size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (photo_size_bytes >= 0),
  photo_expires_at TEXT,
  photo_deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(tab_id) REFERENCES tabs(id) ON DELETE CASCADE,
  FOREIGN KEY(folder_id) REFERENCES card_folders(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_card_orders_tab
ON card_orders(tab_id, created_at);

CREATE INDEX IF NOT EXISTS idx_card_orders_photo_expiration
ON card_orders(photo_expires_at, photo_deleted_at);

CREATE TABLE IF NOT EXISTS card_order_items (
  id TEXT PRIMARY KEY,
  card_order_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  raw_ocr_text TEXT,
  scryfall_id TEXT,
  card_name TEXT NOT NULL,
  set_code TEXT,
  set_name TEXT,
  collector_number TEXT,
  language TEXT,
  finish TEXT NOT NULL DEFAULT 'normal'
    CHECK (finish IN ('normal', 'foil', 'etched')),
  card_condition TEXT NOT NULL DEFAULT 'NM'
    CHECK (card_condition IN ('NM', 'SP', 'MP', 'HP', 'D')),
  image_url TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  total_price_cents INTEGER NOT NULL CHECK (total_price_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(card_order_id) REFERENCES card_orders(id) ON DELETE CASCADE,
  UNIQUE(card_order_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_card_order_items_order
ON card_order_items(card_order_id, sequence);

-- Em banco criado do zero, inclua esta coluna na definição de tab_items.
-- Em banco existente, a migration 0002 executa o ALTER TABLE automaticamente.

INSERT OR IGNORE INTO products
  (id, name, category, default_price_cents, requires_preparation, active, created_at, updated_at)
VALUES
  ('prod_single_cards', 'Cartas avulsas', 'Cartas', 0, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO event_products
  (event_id, product_id, price_cents, available, stock_initial, stock_sold)
SELECT id, 'prod_single_cards', 0, 1, NULL, 0
FROM events;

INSERT OR IGNORE INTO card_folders
  (id, code, name, active, sort_order, created_at, updated_at)
VALUES
  ('folder_main', 'P-01', 'Pasta principal', 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE tab_items ADD COLUMN card_order_id TEXT
REFERENCES card_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tab_items_card_order_unique
ON tab_items(card_order_id)
WHERE card_order_id IS NOT NULL;
