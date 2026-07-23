PRAGMA foreign_keys = ON;

-- Fluxo simplificado de cartas avulsas.
-- Não usa R2, Queue ou Workers AI. A foto comprimida fica temporariamente no D1.

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

ALTER TABLE tab_items ADD COLUMN card_order_id TEXT
REFERENCES card_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tab_items_card_order_unique
ON tab_items(card_order_id)
WHERE card_order_id IS NOT NULL;

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
