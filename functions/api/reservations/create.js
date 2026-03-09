function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function isValidTime(timeStr) {
  return /^\d{2}:\d{2}$/.test(timeStr);
}

function parseDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`);
}

export async function onRequestPost(context) {
  try {
    const { DB } = context.env;
    const body = await context.request.json();

    const firstName = (body.first_name || "").trim();
    const lastName = (body.last_name || "").trim();
    const phone = (body.phone || "").trim();
    const bookingDate = (body.booking_date || "").trim();
    const bookingTime = (body.booking_time || "").trim();
    const guests = Number(body.guests);
    const requests = (body.requests || "").trim();

    if (!firstName || !lastName || !phone || !bookingDate || !bookingTime || !guests) {
      return json({ ok: false, error: "Missing required fields." }, 400);
    }

    if (!isValidDate(bookingDate)) {
      return json({ ok: false, error: "Invalid date format." }, 400);
    }

    if (!isValidTime(bookingTime)) {
      return json({ ok: false, error: "Invalid time format." }, 400);
    }

    if (!Number.isInteger(guests) || guests < 1) {
      return json({ ok: false, error: "Invalid guest count." }, 400);
    }

    const OPEN_TIME = "09:00";
    const CLOSE_TIME = "21:30";

    if (bookingTime < OPEN_TIME) {
      return json({ ok: false, error: `Reservations start from ${OPEN_TIME}.` }, 400);
    }

    if (bookingTime > CLOSE_TIME) {
      return json({ ok: false, error: `Reservations are available until ${CLOSE_TIME}.` }, 400);
    }

    const now = new Date();
    const selectedDateTime = parseDateTime(bookingDate, bookingTime);

    if (Number.isNaN(selectedDateTime.getTime())) {
      return json({ ok: false, error: "Invalid date/time." }, 400);
    }

    if (selectedDateTime <= now) {
      return json({ ok: false, error: "You cannot book in the past." }, 400);
    }

    const minAdvanceMs = 2 * 60 * 60 * 1000;
    if (selectedDateTime.getTime() - now.getTime() < minAdvanceMs) {
      return json({ ok: false, error: "Reservations must be made at least 2 hours in advance." }, 400);
    }

    const depositAmount = 150;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;

    await DB.prepare(`
      INSERT INTO reservations (
        id,
        first_name,
        last_name,
        phone,
        booking_date,
        booking_time,
        guests,
        requests,
        deposit_amount,
        currency,
        status,
        payment_provider,
        payment_ref,
        payment_order_id,
        paid_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      firstName,
      lastName,
      phone,
      bookingDate,
      bookingTime,
      guests,
      requests || null,
      depositAmount,
      "GEL",
      "pending_payment",
      null,
      null,
      null,
      null,
      createdAt,
      updatedAt
    ).run();

    return json({
      ok: true,
      reservationId: id,
      depositAmount,
      redirectUrl: `/mock-payment.html?reservationId=${encodeURIComponent(id)}`,
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Server error.",
      details: String(error),
    }, 500);
  }
}