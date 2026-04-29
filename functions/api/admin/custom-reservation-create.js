import {
  CUSTOM_MAX_GUESTS,
  canFitCustomReservation,
} from "./_custom-reservation.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "—" };
  }

  return {
    firstName: parts.shift(),
    lastName: parts.join(" "),
  };
}

function reasonToMessage(reason) {
  switch (reason) {
    case "min_advance":
      return "Reservations must be made at least 2 hours in advance.";
    case "large_group_limit":
      return "A 5–6 guest group is already booked in that 3-hour block.";
    case "capacity":
      return "No table combination is available for that time.";
    case "invalid_date":
      return "Invalid date.";
    case "invalid_time":
    case "invalid_datetime":
      return "Invalid time.";
    case "invalid_guests":
      return "Guest count must be between 1 and 22.";
    default:
      return "This slot is no longer available.";
  }
}

export async function onRequestPost(context) {
  try {
    const { DB } = context.env;
    const body = await context.request.json();

    const fullName = (body.full_name || "").trim();
    const phone = (body.phone || "").trim();
    const requests = (body.requests || "").trim();
    const bookingDate = (body.booking_date || "").trim();
    const bookingTime = (body.booking_time || "").trim();
    const guests = Number(body.guests);

    if (!fullName) {
      return json({ ok: false, error: "Guest name is required." }, 400);
    }

    if (!Number.isInteger(guests) || guests < 1 || guests > CUSTOM_MAX_GUESTS) {
      return json({ ok: false, error: "Guest count must be between 1 and 22." }, 400);
    }

    const confirmedRows = await DB.prepare(`
      SELECT booking_date, booking_time, guests, status
      FROM reservations
      WHERE booking_date = ?
        AND status IN ('confirmed', 'completed')
    `).bind(bookingDate).all();

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
        error: reasonToMessage(availability.reason),
      }, 409);
    }
    const tableNumber = (body.table_number || "").trim();
    const { firstName, lastName } = splitName(fullName);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await DB.prepare(`
      INSERT INTO reservations (
        id,
        first_name,
        last_name,
        email,
        phone,
        booking_date,
        booking_time,
        guests,
        requests,
        deposit_amount,
        currency,
        status,
        payment_status,
        payment_provider,
        payment_ref,
        payment_order_id,
        paid_at,
        table_number,
        callback_received_at,
        callback_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      firstName,
      lastName,
      "manual@reserve.local",
      phone || "—",
      tableNumber || null,
      bookingDate,
      bookingTime,
      guests,
      requests || null,
      0,
      "GEL",
      "confirmed",
      "manual",
      "admin_manual",
      null,
      null,
      null,
      null,
      null,
      createdAt,
      createdAt
    ).run();

    return json({
      ok: true,
      reservationId: id,
      message: "Custom reservation created.",
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to create custom reservation.",
      details: String(error?.message || error),
    }, 500);
  }
}