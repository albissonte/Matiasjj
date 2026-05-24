/**
 * ================================================================
 * MATIAS JUMP — BOOKING INTEGRATION SNIPPET
 * Paste this <script> block just before </body> in index.html,
 * replacing or extending the existing sendToWhatsApp() section.
 * ================================================================
 *
 * What this does:
 *  1. When the page loads, fetches booked dates for each item and
 *     disables those dates on the date picker.
 *  2. When the user picks an item + date, checks availability live.
 *  3. On form submit, sends the booking to the Cloudflare Worker
 *     and THEN opens WhatsApp so the customer still gets a message.
 */

// ── CONFIG ────────────────────────────────────────────────────
const API_BASE = "/api/booking"; // Cloudflare Pages Function path

// ── STATE ─────────────────────────────────────────────────────
let bookedDatesCache = {}; // { "Item Name": ["2025-07-04", ...] }
let availabilityTimer = null;

// ── ON PAGE LOAD: pre-load booked dates for all items ─────────
document.addEventListener("DOMContentLoaded", () => {
  loadAllBookedDates();
});

async function loadAllBookedDates() {
  // Collect unique item names from the product cards
  const itemNames = Array.from(
    new Set(
      Array.from(document.querySelectorAll(".pcard[data-name]")).map(
        (c) => c.dataset.name
      )
    )
  );

  await Promise.allSettled(
    itemNames.map(async (name) => {
      try {
        const res = await fetch(
          `${API_BASE}/dates?item=${encodeURIComponent(name)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        bookedDatesCache[name] = data.bookedDates || [];
      } catch (e) {
        console.warn("Could not load dates for", name, e);
      }
    })
  );

  // After loading, update date inputs if a cart item is already selected
  refreshDateRestrictions();
}

// ── RESTRICT DATES based on current cart ─────────────────────
function refreshDateRestrictions() {
  const dateInputs = document.querySelectorAll('input[type="date"]');
  // We can't natively disable individual dates on <input type=date>
  // so we validate on change instead (see validateDateForCart below)
  dateInputs.forEach((inp) => {
    inp.addEventListener("change", validateDateForCart);
  });
}

function validateDateForCart(e) {
  const selectedDate = e.target.value;
  if (!selectedDate) return;

  const conflicts = [];
  cart.forEach((item) => {
    const booked = bookedDatesCache[item.name] || [];
    if (booked.includes(selectedDate)) {
      conflicts.push(item.name);
    }
  });

  if (conflicts.length > 0) {
    showAvailabilityBanner(
      `❌ ${conflicts.join(", ")} ${conflicts.length > 1 ? "are" : "is"} already booked on this date. Please choose another date.`,
      "error"
    );
    e.target.value = "";
  } else if (cart.length > 0) {
    showAvailabilityBanner("✅ All selected items are available on this date!", "ok");
  }
}

// ── LIVE AVAILABILITY CHECK (single item) ────────────────────
async function checkItemAvailability(itemName, date) {
  if (!itemName || !date) return null;
  try {
    const res = await fetch(
      `${API_BASE}?item=${encodeURIComponent(itemName)}&date=${date}`
    );
    if (!res.ok) return null;
    return await res.json(); // { available: bool, item, date }
  } catch {
    return null;
  }
}

// ── BANNER HELPER ─────────────────────────────────────────────
function showAvailabilityBanner(message, type = "ok") {
  let banner = document.getElementById("availabilityBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "availabilityBanner";
    banner.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      z-index: 9999; padding: 12px 24px; border-radius: 50px;
      font-family: 'Nunito', sans-serif; font-weight: 800; font-size: .88rem;
      box-shadow: 0 8px 30px rgba(0,0,0,.18); transition: opacity .3s;
      max-width: 90vw; text-align: center;
    `;
    document.body.appendChild(banner);
  }
  banner.style.background = type === "error" ? "#ff4757" : "#00C94A";
  banner.style.color = "#fff";
  banner.textContent = message;
  banner.style.opacity = "1";
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => {
    banner.style.opacity = "0";
  }, 4500);
}

// ── SUBMIT BOOKING TO API (called from sendToWhatsApp) ────────
async function submitBookingToAPI(bookingData) {
  try {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookingData),
    });
    const data = await res.json();

    if (res.status === 409) {
      // Item already booked on that date
      showAvailabilityBanner(data.error, "error");
      alert(`⚠️ ${data.error}`);
      return false;
    }

    if (!res.ok) {
      console.error("Booking API error:", data);
      // Non-blocking: still allow WhatsApp fallback
      return true;
    }

    // Success — update local cache so date is immediately blocked
    cart.forEach((item) => {
      if (!bookedDatesCache[item.name]) bookedDatesCache[item.name] = [];
      const date =
        document.getElementById("cartDate")?.value ||
        document.getElementById("bifDate")?.value;
      if (date && !bookedDatesCache[item.name].includes(date)) {
        bookedDatesCache[item.name].push(date);
      }
    });

    return data.booking_ref; // e.g. "MJ-A3K9PX"
  } catch (err) {
    console.error("submitBookingToAPI failed:", err);
    return true; // Don't block WhatsApp if API is unreachable
  }
}

// ── OVERRIDE sendToWhatsApp to also save to D1 ────────────────
// (replaces the original function defined earlier in the HTML)
async function sendToWhatsApp() {
  const name =
    document.getElementById("cartName")?.value.trim() ||
    document.getElementById("bifName")?.value.trim();
  const email =
    document.getElementById("cartEmail")?.value.trim() ||
    document.getElementById("bifEmail")?.value.trim();
  const date =
    document.getElementById("cartDate")?.value ||
    document.getElementById("bifDate")?.value;
  const time =
    document.getElementById("cartTime")?.value ||
    document.getElementById("bifTime")?.value;
  const address = document.getElementById("cartAddress")?.value.trim();

  if (!name || !email || !date || !time) {
    alert("Please fill in your name, email, event date and time first!");
    return;
  }
  if (cart.length === 0) {
    alert("Your cart is empty! Add some items first.");
    return;
  }
  if (!address) {
    alert("Please add your delivery address!");
    return;
  }

  // Check availability for every item in cart before submitting
  const unavailable = [];
  for (const item of cart) {
    const result = await checkItemAvailability(item.name, date);
    if (result && result.available === false) {
      unavailable.push(item.name);
    }
  }
  if (unavailable.length > 0) {
    alert(
      `⚠️ Sorry! The following items are already booked on ${date}:\n\n• ${unavailable.join("\n• ")}\n\nPlease choose a different date or remove those items.`
    );
    return;
  }

  // Save each cart item as a separate booking row
  // (one item per booking keeps the UNIQUE constraint simple)
  let allRefs = [];
  let blocked = false;

  for (const item of cart) {
    const ref = await submitBookingToAPI({
      customer_name: name,
      customer_email: email,
      customer_phone: "",
      item_name: item.name,
      event_date: date,
      event_time: time,
      delivery_address: address,
      notes: `Qty: ${item.qty}`,
    });

    if (ref === false) {
      blocked = true;
      break;
    }
    if (typeof ref === "string") allRefs.push(ref);
  }

  if (blocked) return; // Availability error already shown

  // Build WhatsApp message (same as before + booking ref)
  const dateFormatted = new Date(date + "T12:00:00").toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" }
  );
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const refLine =
    allRefs.length > 0 ? `🔖 Booking Ref: ${allRefs.join(", ")}\n` : "";

  let msg = `Hi! I'd like to place an order 🎉\n\n`;
  msg += `👤 Name: ${name}\n`;
  msg += `📧 Email: ${email}\n`;
  msg += `📅 Date: ${dateFormatted}\n`;
  msg += `⏰ Time: ${time}\n`;
  msg += `📍 Address: ${address}\n`;
  msg += refLine;
  msg += `\n🛒 ORDER:\n`;
  cart.forEach((item) => {
    msg += `• ${item.name} x${item.qty} — $${item.price * item.qty}\n`;
  });
  msg += `\n💰 Subtotal: $${total}\n`;
  msg += `🚚 Delivery fee: TBD based on location\n\n`;
  msg += `Please confirm availability and payment. Thank you!`;

  window.open(
    `https://wa.me/15718398914?text=${encodeURIComponent(msg)}`,
    "_blank"
  );
}
