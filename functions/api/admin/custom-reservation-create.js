import {
  CUSTOM_MAX_GUESTS,
  canFitCustomReservation,
} from "./_custom-reservation.js";
import { createUndoToken } from "./_undo.js";
import { adminAuthenticated } from "./_auth.js";
import { readCapacitySnapshot } from "../reservations/_capacity.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
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
      return "Reservations must be made at least 1 hour in advance.";
    case "large_group_limit":
      return "A 5–6 guest group is already booked in that 2-hour block.";
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
    if (body.undo === true && !(await adminAuthenticated(context.request, context.env))) return json({ ok: false, error: "Unauthorized" }, 401);

    const fullName = (body.full_name || "").trim();
    const phone = (body.phone || "").trim();
    const tableNumber = (body.table_number || "").trim();
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

    const now = new Date();
    const { reservations, guard } = await readCapacitySnapshot(DB, bookingDate, null, now);

    const availability = canFitCustomReservation({
      dateStr: bookingDate,
      timeStr: bookingTime,
      guests,
      reservations,
      now,
    });

    if (!availability.available) {
      return json({
        ok: false,
        error: reasonToMessage(availability.reason),
      }, 409);
    }

    const { firstName, lastName } = splitName(fullName);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    // Check encryption/configuration and payload size before creating an undo-enabled booking.
    if (body.undo === true) await createUndoToken(context.env, null, { id, requests, first_name: firstName, last_name: lastName, phone });

    const insert = DB.prepare(`
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
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ${guard.sql}
      RETURNING *
    `).bind(
      id,
      firstName,
      lastName,
      "manual@reserve.local",
      phone || "—",
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
      tableNumber || null,
      null,
      null,
      createdAt,
      createdAt,
      ...guard.values
    );
    let undo = null;
    const created = await insert.first();
    if (!created) return json({ ok: false, error: "Availability changed. Please select the time again." }, 409);
    if (body.undo === true) {
      try { undo = await createUndoToken(context.env, null, created); }
      catch (error) { console.error("Reservation created but undo token unavailable", id); }
    }

    return json({
      ok: true,
      reservationId: id,
      message: "Custom reservation created.",
      ...(body.undo === true ? { undo, undoUnavailable: !undo } : {}),
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to create custom reservation.",
      details: String(error?.message || error),
    }, 500);
  }
}
