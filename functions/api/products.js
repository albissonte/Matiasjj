/**
 * Matias Jump — Public Products API
 * Cloudflare Pages Function
 * File: functions/api/products.js
 *
 * Routes:
 *   GET /api/products              — returns all active products
 *   GET /api/products?category=X   — filter by category
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const url      = new URL(request.url);
    const category = url.searchParams.get("category");

    let stmt;
    if (category) {
      stmt = env.DB
        .prepare("SELECT * FROM products WHERE active=1 AND category=? ORDER BY sort_order ASC, id ASC")
        .bind(category);
    } else {
      stmt = env.DB
        .prepare("SELECT * FROM products WHERE active=1 ORDER BY sort_order ASC, id ASC");
    }

    const { results } = await stmt.all();

    // Parse tags from JSON string to array for each product
    const products = results.map(p => ({
      ...p,
      tags: (() => {
        try { return JSON.parse(p.tags || "[]"); }
        catch { return []; }
      })()
    }));

    return json({ ok: true, products });

  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "Internal server error" }, 500);
  }
}
