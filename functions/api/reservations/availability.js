import {
  isValidDate,
  MAX_GUESTS_PER_RESERVATION,
  buildDailyAvailability,
} from "./_availability.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function onRequestGet(context) {
  try {
    const { DB } = context.env;
    const url = new URL(context.request.url);

    const date = (url.searchParams.get("date") || "").trim();
    const guests = Number(url.searchParams.get("guests"));

    if (!isValidDate(date)) {
      return json({ ok: false, error: "Invalid date." }, 400);
    }

    if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS_PER_RESERVATION) {
      return json({ ok: false, error: "Invalid guest count." }, 400);
    }

    const rows = await DB.prepare(`
      SELECT id, booking_date, booking_time, guests, status
      FROM reservations
      WHERE booking_date = ?
        AND status IN ('confirmed', 'completed')
    `).bind(date).all();

    const reservations = rows.results || [];

    const slots = buildDailyAvailability({
      dateStr: date,
      guests,
      reservations,
      now: new Date(),
    });

    return json({
      ok: true,
      date,
      guests,
      slots,
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to load availability.",
      details: String(error),
    }, 500);
  }
}