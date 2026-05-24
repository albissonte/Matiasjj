/**
 * Matias Jump — Booking API
 * Cloudflare Pages Function (functions/api/booking.js)
 *
 * Routes handled:
 *   POST /api/booking          — Create a new reservation
 *   GET  /api/booking?item=X&date=YYYY-MM-DD — Check availability
 *   GET  /api/booking/dates?item=X  — Get all booked dates for an item
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;

  // Preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);

  try {
    // GET /api/booking/dates?item=ITEM_NAME
    if (request.method === "GET" && url.pathname.endsWith("/dates")) {
      return await getBookedDates(env.DB, url);
    }

    // GET /api/booking?item=X&date=YYYY-MM-DD
    if (request.method === "GET") {
      return await checkAvailability(env.DB, url);
    }

    // POST /api/booking
    if (request.method === "POST") {
      return await createBooking(env.DB, request);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error(err);
    return json({ error: "Internal server error", detail: err.message }, 500);
  }
}

// ─── CHECK AVAILABILITY ──────────────────────────────────────────────────────
async function checkAvailability(db, url) {
  const item = url.searchParams.get("item");
  const date = url.searchParams.get("date");

  if (!item || !date) {
    return json({ error: "Missing 'item' or 'date' parameter" }, 400);
  }

  if (!isValidDate(date)) {
    return json({ error: "Invalid date format. Use YYYY-MM-DD" }, 400);
  }

  const row = await db
    .prepare(
      `SELECT id FROM bookings
       WHERE item_name = ? AND event_date = ? AND status != 'cancelled'
       LIMIT 1`
    )
    .bind(item, date)
    .first();

  return json({ available: !row, item, date });
}

// ─── GET ALL BOOKED DATES FOR AN ITEM ────────────────────────────────────────
async function getBookedDates(db, url) {
  const item = url.searchParams.get("item");
  if (!item) {
    return json({ error: "Missing 'item' parameter" }, 400);
  }

  const { results } = await db
    .prepare(
      `SELECT event_date FROM bookings
       WHERE item_name = ? AND status != 'cancelled'
       ORDER BY event_date ASC`
    )
    .bind(item)
    .all();

  const dates = results.map((r) => r.event_date);
  return json({ item, bookedDates: dates });
}

// ─── CREATE BOOKING ──────────────────────────────────────────────────────────
async function createBooking(db, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { customer_name, customer_email, customer_phone, item_name, event_date, event_time, delivery_address, notes } = body;

  // ── Validation ──
  const missing = [];
  if (!customer_name?.trim()) missing.push("customer_name");
  if (!customer_email?.trim()) missing.push("customer_email");
  if (!item_name?.trim()) missing.push("item_name");
  if (!event_date) missing.push("event_date");
  if (!event_time) missing.push("event_time");
  if (!delivery_address?.trim()) missing.push("delivery_address");

  if (missing.length) {
    return json({ error: "Missing required fields", fields: missing }, 400);
  }

  if (!isValidDate(event_date)) {
    return json({ error: "Invalid date format. Use YYYY-MM-DD" }, 400);
  }

  if (!isValidEmail(customer_email)) {
    return json({ error: "Invalid email address" }, 400);
  }

  // ── Enforce future dates ──
  const today = new Date().toISOString().split("T")[0];
  if (event_date <= today) {
    return json({ error: "Event date must be in the future" }, 400);
  }

  // ── Check availability (atomic-ish with UNIQUE constraint) ──
  const existing = await db
    .prepare(
      `SELECT id FROM bookings
       WHERE item_name = ? AND event_date = ? AND status != 'cancelled'
       LIMIT 1`
    )
    .bind(item_name, event_date)
    .first();

  if (existing) {
    return json(
      { error: "This item is already booked for that date. Please choose another date.", available: false },
      409
    );
  }

  // ── Insert ──
  const bookingRef = generateRef();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO bookings
         (booking_ref, customer_name, customer_email, customer_phone,
          item_name, event_date, event_time, delivery_address, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .bind(
      bookingRef,
      customer_name.trim(),
      customer_email.trim().toLowerCase(),
      customer_phone?.trim() || null,
      item_name.trim(),
      event_date,
      event_time,
      delivery_address.trim(),
      notes?.trim() || null,
      now
    )
    .run();

  return json(
    {
      success: true,
      booking_ref: bookingRef,
      message: "Booking received! We will confirm via WhatsApp or email shortly.",
    },
    201
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

function generateRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "MJ-";
  for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
  }
