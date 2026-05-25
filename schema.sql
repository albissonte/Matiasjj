-- ============================================================
--  Matias Jump Jumping — Cloudflare D1 Schema
--  Ejecutar en: Cloudflare Dashboard → D1 → tu base → Console
--  O con: wrangler d1 execute matiasjump-db --file=schema.sql
-- ============================================================

-- ------------------------------------------------------------
-- Tabla de reservas (compatible con booking.js existente)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_ref      TEXT    NOT NULL UNIQUE,          -- "MJ-A3K9PX"
  customer_name    TEXT    NOT NULL,
  customer_email   TEXT    NOT NULL,
  customer_phone   TEXT,
  item_name        TEXT    NOT NULL,
  event_date       TEXT    NOT NULL,                 -- "YYYY-MM-DD"
  event_time       TEXT    NOT NULL,
  delivery_address TEXT    NOT NULL,
  notes            TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending', -- pending/confirmed/cancelled/completed
  internal_notes   TEXT,                             -- solo admin
  created_at       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_date   ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_item   ON bookings(item_name);

-- ------------------------------------------------------------
-- Productos del catálogo (admin puede editar desde el panel)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  category     TEXT    NOT NULL DEFAULT 'combo',     -- combo/castle/mini/water/extras
  description  TEXT,
  price        REAL    NOT NULL DEFAULT 0,
  badge_text   TEXT,
  badge_color  TEXT    DEFAULT '#FF6B00',
  tags         TEXT    DEFAULT '[]',                 -- JSON array
  image_url    TEXT,
  active       INTEGER NOT NULL DEFAULT 1,           -- 1=visible, 0=hidden
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_active   ON products(active);

-- ------------------------------------------------------------
-- Fechas bloqueadas (admin las marca como no disponibles)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocked_dates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT    NOT NULL UNIQUE,               -- "YYYY-MM-DD"
  reason     TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blocked_date ON blocked_dates(date);

-- ------------------------------------------------------------
-- Sesiones admin (login seguro sin base de datos externa)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT    NOT NULL PRIMARY KEY,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);

-- ------------------------------------------------------------
-- Productos iniciales (los del sitio actual)
-- ------------------------------------------------------------
INSERT OR IGNORE INTO products (name, category, description, price, badge_text, badge_color, tags, sort_order) VALUES
('Big Bounce Castle Blue',        'castle', 'Classic blue bounce house, perfect for any party',        220, '🏰 Castle',   '#00AAFF', '["👦 Kids","📏 15×15","🎉 Classic"]',                1),
('Big Bounce Castle Pink',        'castle', 'Pink princess bounce house',                              220, '🏰 Castle',   '#FF1493', '["👧 Princess","📏 15×15","💕 Pink"]',               2),
('Big Combo Violet Castle',       'combo',  'Violet Castle Big combo with wavy double slide',          280, '🎪 Combo',    '#8B00FF', '["💟 Princess","📏 16×32","🛝 Wavy double slide"]',  3),
('Combo TropicalPalms Slide',     'combo',  'Tropical themed combo with palm slide',                   250, '🌴 Tropical', '#00C94A', '["🌺 Tropical","📏 15×28","🛝 Slide"]',              4),
('Mini Combo Red Towers',         'mini',   'Compact red combo, great for smaller spaces',             220, '⚡ Mini',     '#FF6B00', '["🔴 Red","📏 12×20","🛝 Slide"]',                   5),
('Water Slide Blue Wave',         'water',  'Cool water slide for hot summer days',                    280, '💦 Water',    '#00AAFF', '["💧 Water","📏 10×25","☀️ Summer"]',                6),
('Water Slide Rainbow',           'water',  'Rainbow water slide, colorful and fun',                   300, '🌈 Rainbow',  '#FF6B00', '["🌈 Rainbow","📏 10×28","💦 Splash"]',              7),
('Rectangular Table',             'extras', '6ft rectangular table rental',                              8, '🪑 Table',    '#555555', '["📐 6ft","🪑 Seats 8"]',                            8),
('60" Round Table',               'extras', 'Round table 60 inch diameter',                             11, '⭕ Table',    '#555555', '["⭕ 60in","🪑 Seats 8"]',                           9),
('Chair',                         'extras', 'Folding chair rental',                                      2, '🪑 Chair',    '#555555', '["🪑 Folding","✅ White"]',                          10),
('Generator',                     'extras', 'Power generator for locations without electricity',         80, '⚡ Power',    '#FFD700', '["⚡ 3500W","🔌 All units"]',                        11),
('Concession — Snow Cone Machine','extras', 'Snow cone machine with supplies for ~50 servings',          60, '🍧 Food',     '#00AAFF', '["🍧 Snow Cone","👥 ~50 serv"]',                    12),
('Concession — Popcorn Machine',  'extras', 'Popcorn machine with supplies for ~50 servings',            60, '🍿 Food',     '#FFD700', '["🍿 Popcorn","👥 ~50 serv"]',                      13),
('Concession — Cotton Candy',     'extras', 'Cotton candy machine with supplies',                        60, '🩷 Food',     '#FF1493', '["🩷 Cotton Candy","👥 ~50 serv"]',                 14);
