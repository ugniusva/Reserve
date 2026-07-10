import {
  OPEN_TIME,
  CLOSE_TIME,
  isValidDate,
  isValidTimeSlotFormat,
  parseDateTime,
} from "../reservations/_availability.js";
import {
  CUSTOM_MAX_GUESTS,
  canFitCustomReservation,
} from "./_custom-reservation.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isAuthenticated(request) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.includes("admin_auth=ok");
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function availabilityReasonToMessage(reason) {
  switch (reason) {
    case "min_advance":
      return "Reservations must be made at least 1 hour in advance.";
    case "large_group_limit":
      return "A large group is already booked in that 2-hour block.";
    case "capacity":
      return "No table combination is available for that time.";
    case "invalid_date":
      return "Invalid reservation date.";
    case "invalid_time":
    case "invalid_datetime":
      return "Invalid reservation time.";
    case "invalid_guests":
      return `Guest count must be between 1 and ${CUSTOM_MAX_GUESTS}.`;
    default:
      return "This reservation time is not available.";
  }
}

export async function onRequestPost(context) {
  try {
    if (!isAuthenticated(context.request)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const { DB } = context.env;
    const body = await context.request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const id = String(body.id || "").trim();

    const allowedStatuses = [
      "pending_payment",
      "confirmed",
      "payment_failed",
      "cancelled",
      "completed",
      "no_show",
    ];

    if (!id) {
      return json({ ok: false, error: "Missing reservation ID." }, 400);
    }

    const current = await DB.prepare(`
      SELECT
        id,
        first_name,
        last_name,
        phone,
        booking_date,
        booking_time,
        guests,
        table_number,
        status
      FROM reservations
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

    if (!current) {
      return json({ ok: false, error: "Reservation not found." }, 404);
    }

    const firstName = hasOwn(body, "first_name")
      ? String(body.first_name || "").trim()
      : String(current.first_name || "").trim();
    const lastName = hasOwn(body, "last_name")
      ? String(body.last_name || "").trim()
      : String(current.last_name || "").trim();
    const phone = hasOwn(body, "phone")
      ? String(body.phone || "").trim()
      : String(current.phone || "").trim();
    const bookingDate = hasOwn(body, "booking_date")
      ? String(body.booking_date || "").trim()
      : String(current.booking_date || "").trim();
    const bookingTime = hasOwn(body, "booking_time")
      ? String(body.booking_time || "").trim()
      : String(current.booking_time || "").trim();
    const guests = hasOwn(body, "guests")
      ? Number(body.guests)
      : Number(current.guests);
    const tableNumber = hasOwn(body, "table_number")
      ? String(body.table_number || "").trim()
      : String(current.table_number || "").trim();
    const status = hasOwn(body, "status")
      ? String(body.status || "").trim()
      : String(current.status || "").trim();

    if (!firstName || !lastName) {
      return json({ ok: false, error: "Name is required." }, 400);
    }

    if (!phone) {
      return json({ ok: false, error: "Phone is required." }, 400);
    }

    if (!isValidDate(bookingDate)) {
      return json({ ok: false, error: "Invalid reservation date." }, 400);
    }

    if (!isValidTimeSlotFormat(bookingTime)) {
      return json({ ok: false, error: "Invalid reservation time." }, 400);
    }

    if (bookingTime < OPEN_TIME || bookingTime > CLOSE_TIME) {
      return json({
        ok: false,
        error: `Reservations are available between ${OPEN_TIME} and ${CLOSE_TIME}.`,
      }, 400);
    }

    const selectedDateTime = parseDateTime(bookingDate, bookingTime);
    if (Number.isNaN(selectedDateTime.getTime())) {
      return json({ ok: false, error: "Invalid reservation date/time." }, 400);
    }

    if (!Number.isInteger(guests) || guests < 1 || guests > CUSTOM_MAX_GUESTS) {
      return json({
        ok: false,
        error: `Guest count must be between 1 and ${CUSTOM_MAX_GUESTS}.`,
      }, 400);
    }

    if (!allowedStatuses.includes(status)) {
      return json({ ok: false, error: "Invalid status." }, 400);
    }

    const availabilityChanged =
      bookingDate !== String(current.booking_date || "") ||
      bookingTime !== String(current.booking_time || "") ||
      guests !== Number(current.guests);

    if (availabilityChanged) {
      const confirmedRows = await DB.prepare(`
        SELECT id, booking_date, booking_time, guests, status
        FROM reservations
        WHERE booking_date = ?
          AND status IN ('confirmed', 'completed')
          AND id <> ?
      `).bind(bookingDate, id).all();

      const availability = canFitCustomReservation({
        dateStr: bookingDate,
        timeStr: bookingTime,
        guests,
        reservations: confirmedRows.results || [],
        now: new Date(),
      });

      if (!availability.available) {
        return json({
          ok: false,
          error: availabilityReasonToMessage(availability.reason),
        }, 409);
      }
    }

    const updatedAt = new Date().toISOString();

    const result = await DB.prepare(`
      UPDATE reservations
      SET
        first_name = ?,
        last_name = ?,
        phone = ?,
        booking_date = ?,
        booking_time = ?,
        guests = ?,
        table_number = ?,
        status = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      firstName,
      lastName,
      phone,
      bookingDate,
      bookingTime,
      guests,
      tableNumber || null,
      status,
      updatedAt,
      id
    ).run();

    return json({ ok: true, result });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to update reservation.",
      details: String(error),
    }, 500);
  }
}
