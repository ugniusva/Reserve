import {
  CUSTOM_MAX_GUESTS,
  addDays,
  canFitCustomReservation,
  getTimeSlots,
  groupReservationsByDate,
  toIsoDate,
} from "./_custom-reservation.js";
import { capacityStatusWhere, paymentHoldCutoff, readCapacitySnapshot } from "../reservations/_capacity.js";
import { isValidDate } from "../reservations/_availability.js";

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

    const guests = Number(url.searchParams.get("guests"));
    const dateStr = (url.searchParams.get("date") || "").trim();
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") || 45)));

    if (!Number.isInteger(guests) || guests < 1 || guests > CUSTOM_MAX_GUESTS) {
      return json({ ok: false, error: "Guest count must be between 1 and 22." }, 400);
    }

    const now = new Date();

    if (dateStr) {
      if (!isValidDate(dateStr)) return json({ ok: false, error: "Invalid date." }, 400);
      const { reservations } = await readCapacitySnapshot(DB, dateStr, null, now);
      const slots = getTimeSlots().map((time) => {
        const result = canFitCustomReservation({
          dateStr,
          timeStr: time,
          guests,
          reservations,
          now,
        });

        return {
          time,
          available: result.available,
          reason: result.reason || null,
        };
      });

      return json({
        ok: true,
        guests,
        date: dateStr,
        slots,
      });
    }

    const startDate = toIsoDate(now);
    const endDate = toIsoDate(addDays(now, days - 1));

    const rows = await DB.prepare(`
      SELECT booking_date, booking_time, guests, status
      FROM reservations
      WHERE booking_date BETWEEN ? AND ?
        AND ${capacityStatusWhere()}
    `).bind(startDate, endDate, paymentHoldCutoff(now)).all();

    const grouped = groupReservationsByDate(rows.results || []);
    const slots = getTimeSlots();
    const dates = [];

    for (let offset = 0; offset < days; offset += 1) {
      const date = toIsoDate(addDays(now, offset));
      const reservations = grouped.get(date) || [];

      let available = false;

      for (const time of slots) {
        const result = canFitCustomReservation({
          dateStr: date,
          timeStr: time,
          guests,
          reservations,
          now,
        });

        if (result.available) {
          available = true;
          break;
        }
      }

      dates.push({ date, available });
    }

    return json({
      ok: true,
      guests,
      dates,
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to load custom reservation availability.",
      details: String(error?.message || error),
    }, 500);
  }
}
