import {
  isValidDate,
  MAX_GUESTS_PER_RESERVATION,
  buildDailyAvailability,
  getRestaurantDate,
} from "./_availability.js";
import { readCapacitySnapshot } from "./_capacity.js";
import { isClosedSlot, readBookingClosures, readClosedDateRanges } from "./_closures.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet(context) {
  try {
    const { DB } = context.env;
    const url = new URL(context.request.url);
    const now = new Date();

    // Calendar bootstrap uses the same server clock as slot validation.
    if (url.searchParams.get("clock") === "1") {
      const today = getRestaurantDate(now);
      const closed_date_ranges = await readClosedDateRanges(DB, today);
      return json({ ok: true, server_now: now.toISOString(), today, closed_date_ranges });
    }

    const date = (url.searchParams.get("date") || "").trim();
    const guests = Number(url.searchParams.get("guests"));

    if (!isValidDate(date)) {
      return json({ ok: false, error: "Invalid date." }, 400);
    }

    if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS_PER_RESERVATION) {
      return json({ ok: false, error: "Invalid guest count." }, 400);
    }

    const { reservations } = await readCapacitySnapshot(DB, date, null, now);

    const closures = await readBookingClosures(DB, date);
    const slots = buildDailyAvailability({
      dateStr: date,
      guests,
      reservations,
      now,
    }).map(slot => isClosedSlot(closures, date, slot.time)
      ? { ...slot, available: false, reason: "closed" }
      : slot);

    return json({
      ok: true,
      server_now: now.toISOString(),
      today: getRestaurantDate(now),
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
