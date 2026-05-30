/**
 * Matias Jump — Admin API
 * Cloudflare Pages Function
 * File: functions/api/admin/[[route]].js
 *
 * Routes:
 *   POST /api/admin/login
 *   POST /api/admin/logout
 *   GET  /api/admin/me               — check session
 *
 *   GET  /api/admin/stats
 *   GET  /api/admin/bookings          — ?status= &from= &to= &q=
 *   GET  /api/admin/bookings/:id
 *   POST /api/admin/bookings/:id      — update status / internal_notes
 *   DELETE /api/admin/bookings/:id
 *
 *   GET  /api/admin/products
 *   POST /api/admin/products          — create
 *   PUT  /api/admin/products/:id      — update
 *   DELETE /api/admin/products/:id
 *
 *   GET  /api/admin/blocked-dates
 *   POST /api/admin/blocked-dates     — block
 *   DELETE /api/admin/blocked-dates/:date — unblock
 *
 * Env vars needed in wrangler.toml / Cloudflare dashboard:
 *   DB             — D1 database binding
 *   ADMIN_USER     — admin username  (e.g. "matias")
 *   ADMIN_PASSWORD — plain-text password (stored only in env, never in DB)
 *   SESSION_SECRET — random 32-char string for HMAC token signing
 */

// ─── CORS + JSON helpers ──────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url      = new URL(request.url);
  // params.route is an array of path segments after /api/admin/
  const segments = params.route || [];
  const resource = segments[0] || "";   // "login" | "bookings" | "products" | ...
  const subId    = segments[1] || "";   // id or date for sub-routes
  const method   = request.method;

  // ── Public routes (no auth) ──
  if (resource === "login" && method === "POST") {
    return handleLogin(env, request);
  }

  // ── All other routes require a valid session ──
  const authErr = await requireAuth(env, request);
  if (authErr) return authErr;

  if (resource === "logout" && method === "POST") {
    return handleLogout(env, request);
  }

  if (resource === "me") {
    return json({ ok: true, user: env.ADMIN_USER });
  }

  try {
    // STATS
    if (resource === "stats" && method === "GET") return getStats(env.DB);

    // BOOKINGS
    if (resource === "bookings") {
      if (!subId && method === "GET")    return getBookings(env.DB, url);
      if (subId  && method === "GET")    return getBooking(env.DB, subId);
      if (subId  && method === "POST")   return updateBooking(env.DB, subId, request);
      if (subId  && method === "DELETE") return deleteBooking(env.DB, subId);
    }

    // PRODUCTS
    if (resource === "products") {
      if (!subId && method === "GET")                    return getProducts(env.DB);
      if (!subId && method === "POST")                   return createProduct(env.DB, request);
      if (subId === "reorder" && method === "POST")     return reorderProducts(env.DB, request);
      if (subId  && method === "PUT")                    return updateProduct(env.DB, subId, request);
      if (subId  && method === "DELETE")                 return deleteProduct(env.DB, subId);
    }

    // BLOCKED DATES
    if (resource === "blocked-dates") {
      if (!subId && method === "GET")    return getBlockedDates(env.DB);
      if (!subId && method === "POST")   return blockDate(env.DB, request);
      if (subId  && method === "DELETE") return unblockDate(env.DB, subId);
    }

    return err("Not found", 404);
  } catch (e) {
    console.error(e);
    return err("Internal server error: " + e.message, 500);
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

async function makeToken(secret, user) {
  const payload = `${user}:${Date.now()}`;
  const key     = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,"0")).join("");
  return btoa(`${payload}:${hex}`);
}

async function verifyToken(secret, token) {
  try {
    const decoded  = atob(token);
    const lastColon = decoded.lastIndexOf(":");
    const payload  = decoded.slice(0, lastColon);
    const hex      = decoded.slice(lastColon + 1);
    const key      = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sigBytes = Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const valid    = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
    if (!valid) return false;
    // Expire after 12 hours
    const ts = parseInt(payload.split(":")[1]);
    return (Date.now() - ts) < 12 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

async function handleLogin(env, request) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON"); }

  const { username, password } = body;
  if (!username || !password) return err("Username and password required");
  
  // DEBUG TEMPORAL
  if (username !== env.ADMIN_USER) return err(`User mismatch: got '${username}' expected '${env.ADMIN_USER}'`, 401);
  if (password !== env.ADMIN_PASSWORD) return err(`Pass mismatch: got '${password}' expected '${env.ADMIN_PASSWORD}'`, 401);

  const token = await makeToken(env.SESSION_SECRET, username);
  return json({ ok: true, token });
}

async function handleLogout(env, request) {
  // Stateless JWT-style — client just drops the token
  return json({ ok: true });
}

async function requireAuth(env, request) {
  const auth  = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return err("Unauthorized", 401);
  const valid = await verifyToken(env.SESSION_SECRET, token);
  if (!valid)  return err("Session expired. Please log in again.", 401);
  return null; // OK
}

// ─── STATS ───────────────────────────────────────────────────────────────────

async function getStats(db) {
  const [total, pending, confirmed, revenue, upcoming] = await Promise.all([
    db.prepare("SELECT COUNT(*) as n FROM bookings").first(),
    db.prepare("SELECT COUNT(*) as n FROM bookings WHERE status='pending'").first(),
    db.prepare("SELECT COUNT(*) as n FROM bookings WHERE status='confirmed'").first(),
    db.prepare("SELECT COALESCE(SUM(CAST(REPLACE(notes,'Qty: ','') AS REAL)*0+0),0) as n FROM bookings WHERE status IN ('confirmed','completed')").first(),
    db.prepare(`
      SELECT id, booking_ref, customer_name, event_date, event_time, item_name, status
      FROM bookings
      WHERE event_date BETWEEN date('now') AND date('now','+7 days')
        AND status IN ('pending','confirmed')
      ORDER BY event_date ASC LIMIT 6
    `).all(),
    db.prepare("SELECT COUNT(*) as n FROM products WHERE active=1").first(),
    db.prepare("SELECT COUNT(*) as n FROM blocked_dates").first(),
  ]);

  const [products, blocked] = await Promise.all([
    db.prepare("SELECT COUNT(*) as n FROM products WHERE active=1").first(),
    db.prepare("SELECT COUNT(*) as n FROM blocked_dates").first(),
  ]);

  return json({
    ok: true,
    stats: {
      total_bookings:     total?.n     || 0,
      pending_bookings:   pending?.n   || 0,
      confirmed_bookings: confirmed?.n || 0,
      active_products:    products?.n  || 0,
      blocked_dates:      blocked?.n   || 0,
      upcoming:           upcoming.results || [],
    },
  });
}

// ─── BOOKINGS ────────────────────────────────────────────────────────────────

async function getBookings(db, url) {
  const status = url.searchParams.get("status");
  const from   = url.searchParams.get("from");
  const to     = url.searchParams.get("to");
  const q      = url.searchParams.get("q")?.toLowerCase();

  let sql    = "SELECT * FROM bookings WHERE 1=1";
  const bind = [];

  if (status && ["pending","confirmed","cancelled","completed"].includes(status)) {
    sql += " AND status = ?"; bind.push(status);
  }
  if (from) { sql += " AND event_date >= ?"; bind.push(from); }
  if (to)   { sql += " AND event_date <= ?"; bind.push(to); }

  sql += " ORDER BY event_date ASC, created_at DESC";

  let stmt   = db.prepare(sql);
  if (bind.length) stmt = stmt.bind(...bind);
  const { results } = await stmt.all();

  // Client-side filter for search (D1 doesn't have full-text search)
  const rows = q
    ? results.filter(r =>
        r.customer_name?.toLowerCase().includes(q)  ||
        r.customer_email?.toLowerCase().includes(q) ||
        r.booking_ref?.toLowerCase().includes(q)    ||
        r.item_name?.toLowerCase().includes(q)
      )
    : results;

  return json({ ok: true, bookings: rows });
}

async function getBooking(db, id) {
  const row = await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
  if (!row) return err("Not found", 404);
  return json({ ok: true, booking: row });
}

async function updateBooking(db, id, request) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON"); }

  const validStatus = ["pending","confirmed","cancelled","completed"];
  const fields = [], bind = [];

  if (body.status !== undefined) {
    if (!validStatus.includes(body.status)) return err("Invalid status");
    fields.push("status = ?"); bind.push(body.status);
  }
  if (body.internal_notes !== undefined) {
    fields.push("internal_notes = ?"); bind.push(body.internal_notes);
  }
  if (!fields.length) return err("Nothing to update");

  bind.push(id);
  await db.prepare(`UPDATE bookings SET ${fields.join(", ")} WHERE id = ?`).bind(...bind).run();
  return json({ ok: true });
}

async function deleteBooking(db, id) {
  await db.prepare("DELETE FROM bookings WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ─── PRODUCTS ────────────────────────────────────────────────────────────────

async function getProducts(db) {
  const { results } = await db
    .prepare("SELECT * FROM products ORDER BY sort_order ASC, id ASC")
    .all();
  return json({ ok: true, products: results });
}

async function createProduct(db, request) {
  const b = await parseBody(request);
  if (!b.name?.trim()) return err("Name is required");
  if (b.price === undefined || b.price === "") return err("Price is required");

  const now = new Date().toISOString();
  const tags = normalizeTags(b.tags);

  const result = await db.prepare(`
    INSERT INTO products (name, category, description, price, badge_text, badge_color, tags, image_url, active, sort_order, stock, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    b.name.trim(),
    b.category   || "extras",
    b.description || "",
    parseFloat(b.price) || 0,
    b.badge_text  || "",
    b.badge_color || "#FF6B00",
    tags,
    b.image_url   || "",
    b.active !== undefined ? parseInt(b.active) : 1,
    parseInt(b.sort_order) || 0,
    parseInt(b.stock) || 1,
    now, now
  ).run();

  return json({ ok: true, id: result.meta?.last_row_id }, 201);
}

async function updateProduct(db, id, request) {
  const b = await parseBody(request);
  if (!b.name?.trim()) return err("Name is required");

  const tags = normalizeTags(b.tags);
  const now  = new Date().toISOString();

  await db.prepare(`
    UPDATE products SET
      name=?, category=?, description=?, price=?, badge_text=?,
      badge_color=?, tags=?, image_url=?, active=?, sort_order=?, stock=?, updated_at=?
    WHERE id=?
  `).bind(
    b.name.trim(),
    b.category    || "extras",
    b.description || "",
    parseFloat(b.price) || 0,
    b.badge_text  || "",
    b.badge_color || "#FF6B00",
    tags,
    b.image_url   || "",
    b.active !== undefined ? parseInt(b.active) : 1,
    parseInt(b.sort_order) || 0,
    parseInt(b.stock) || 1,
    now,
    id
  ).run();

  return json({ ok: true });
}


async function reorderProducts(db, request) {
  const b = await parseBody(request);
  if (!Array.isArray(b.order)) return err('order must be an array');
  const stmts = b.order.map(item =>
    db.prepare('UPDATE products SET sort_order=? WHERE id=?').bind(item.sort_order, item.id)
  );
  await db.batch(stmts);
  return json({ ok: true });
}

async function deleteProduct(db, id) {
  await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ─── BLOCKED DATES ───────────────────────────────────────────────────────────

async function getBlockedDates(db) {
  const { results } = await db
    .prepare("SELECT * FROM blocked_dates ORDER BY date ASC")
    .all();
  return json({ ok: true, dates: results });
}

async function blockDate(db, request) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON"); }

  const { date, reason } = body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err("Invalid date");

  await db.prepare(
    "INSERT OR IGNORE INTO blocked_dates (date, reason) VALUES (?, ?)"
  ).bind(date, reason || "").run();

  return json({ ok: true });
}

async function unblockDate(db, date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err("Invalid date");
  await db.prepare("DELETE FROM blocked_dates WHERE date = ?").bind(date).run();
  return json({ ok: true });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function parseBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function normalizeTags(tags) {
  if (!tags) return "[]";
  if (Array.isArray(tags)) return JSON.stringify(tags);
  if (typeof tags === "string") {
    try { JSON.parse(tags); return tags; } catch {
      // treat as comma-separated
      return JSON.stringify(tags.split(",").map(t => t.trim()).filter(Boolean));
    }
  }
  return "[]";
}

