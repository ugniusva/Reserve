import {
  OPEN_TIME,
  CLOSE_TIME,
  isValidDate,
  isValidTimeSlotFormat,
  parseDateTime,
  canFitReservation,
} from "./_availability.js";

const DEPOSIT_PER_PERSON = 50; // testing; later change to 50

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function availabilityReasonToMessage(reason) {
  switch (reason) {
    case "min_advance":
      return "Reservations must be made at least 2 hours in advance.";
    case "capacity":
    case "two_tables_full":
    case "four_tables_full":
    case "large_group_limit":
      return "This time is no longer available.";
    case "invalid_guests":
      return "Invalid guest count.";
    case "invalid_date":
      return "Invalid date format.";
    case "invalid_time":
    case "invalid_datetime":
      return "Invalid date/time.";
    default:
      return "This time is not available.";
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function maskEmail(email) {
  const value = String(email || "").trim();
  const at = value.indexOf("@");

  if (at <= 1) return value || undefined;

  const name = value.slice(0, at);
  const domain = value.slice(at);
  const visible = name.slice(0, 2);

  return `${visible}${"*".repeat(Math.max(1, name.length - 2))}${domain}`;
}

function maskPhone(phone) {
  const value = String(phone || "").trim();
  const digits = value.replace(/\D/g, "");

  if (digits.length < 4) return value || undefined;

  const tail = digits.slice(-4);
  return `****${tail}`;
}

async function getBogAccessToken(env) {
  const tokenUrl =
    "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token";

  const basic = btoa(`${env.BOG_CLIENT_ID}:${env.BOG_CLIENT_SECRET}`);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`BOG token request failed: ${response.status} ${JSON.stringify(data)}`);
  }

  if (!data.access_token) {
    throw new Error(`BOG token response missing access_token: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

async function createBogOrder({ env, request, reservation, amount }) {
  const accessToken = await getBogAccessToken(env);
  const origin = new URL(request.url).origin;
  const buyerName = `${reservation.first_name || ""} ${reservation.last_name || ""}`.trim();

  const payload = {
    callback_url: `${origin}/api/bog/callback`,
    external_order_id: reservation.id,
    purchase_units: {
      currency: "GEL",
      total_amount: amount,
      basket: [
        {
          product_id: "reservation-deposit",
          description: `Reserve Restaurant deposit for ${reservation.booking_date} ${reservation.booking_time}`,
          quantity: 1,
          unit_price: amount,
          total_price: amount,
        },
      ],
    },
    redirect_urls: {
      success: `${origin}/reservation-success.html?reservationId=${encodeURIComponent(reservation.id)}`,
      fail: `${origin}/reservation-failed.html?reservationId=${encodeURIComponent(reservation.id)}`,
    },
    buyer: {
      full_name: buyerName || undefined,
      masked_email: maskEmail(reservation.email),
      masked_phone: maskPhone(reservation.phone),
    },
  };

  const response = await fetch("https://api.bog.ge/payments/v1/ecommerce/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "Accept-Language": "en",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`BOG order creation failed: ${response.status} ${JSON.stringify(data)}`);
  }

  const orderId = data?.id || null;
  const redirectUrl = data?._links?.redirect?.href || null;
  const detailsUrl = data?._links?.details?.href || null;

  if (!orderId || !redirectUrl) {
    throw new Error(`BOG order response missing required fields: ${JSON.stringify(data)}`);
  }

  return {
    orderId,
    redirectUrl,
    detailsUrl,
  };
}

export async function onRequestPost(context) {
  try {
    const { DB } = context.env;
    const body = await context.request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const firstName = String(body.first_name || "").trim();
    const lastName = String(body.last_name || "").trim();
    const email = String(body.email || "").trim();
    const phone = String(body.phone || "").trim();
    const bookingDate = String(body.booking_date || "").trim();
    const bookingTime = String(body.booking_time || "").trim();
    const guests = Number(body.guests);
    const requests = String(body.requests || "").trim();

    if (!firstName || !lastName || !email || !phone || !bookingDate || !bookingTime || !guests) {
      return json({ ok: false, error: "Missing required fields." }, 400);
    }

    if (!isValidEmail(email)) {
      return json({ ok: false, error: "Invalid email format." }, 400);
    }

    if (!isValidDate(bookingDate)) {
      return json({ ok: false, error: "Invalid date format." }, 400);
    }

    if (!isValidTimeSlotFormat(bookingTime)) {
      return json({ ok: false, error: "Invalid time format." }, 400);
    }

    if (!Number.isInteger(guests) || guests < 1 || guests > 6) {
      return json({ ok: false, error: "Invalid guest count." }, 400);
    }

    if (bookingTime < OPEN_TIME) {
      return json({ ok: false, error: `Reservations start from ${OPEN_TIME}.` }, 400);
    }

    if (bookingTime > CLOSE_TIME) {
      return json({ ok: false, error: `Reservations are available until ${CLOSE_TIME}.` }, 400);
    }

    const selectedDateTime = parseDateTime(bookingDate, bookingTime);
    if (Number.isNaN(selectedDateTime.getTime())) {
      return json({ ok: false, error: "Invalid date/time." }, 400);
    }

    const confirmedRows = await DB.prepare(`
      SELECT id, booking_date, booking_time, guests, status
      FROM reservations
      WHERE booking_date = ?
        AND status IN ('confirmed', 'completed')
    `).bind(bookingDate).all();

    const availability = canFitReservation({
      dateStr: bookingDate,
      timeStr: bookingTime,
      guests,
      reservations: confirmedRows.results || [],
      now: new Date(),
    });

    if (!availability.available) {
      return json(
        {
          ok: false,
          error: availabilityReasonToMessage(availability.reason),
        },
        409
      );
    }

    const depositAmount = guests * DEPOSIT_PER_PERSON;

    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      return json({ ok: false, error: "Invalid deposit amount." }, 500);
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;

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
        callback_received_at,
        callback_payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      firstName,
      lastName,
      email,
      phone,
      bookingDate,
      bookingTime,
      guests,
      requests || null,
      depositAmount,
      "GEL",
      "pending_payment",
      "created",
      "bog",
      null,
      null,
      null,
      null,
      null,
      createdAt,
      updatedAt
    ).run();

    try {
      const bogOrder = await createBogOrder({
        env: context.env,
        request: context.request,
        reservation: {
          id,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          booking_date: bookingDate,
          booking_time: bookingTime,
          guests,
        },
        amount: depositAmount,
      });

      await DB.prepare(`
  UPDATE reservations
  SET
    payment_provider = ?,
    payment_order_id = ?,
    payment_status = ?,
    updated_at = ?
  WHERE id = ?
`).bind(
  "bog",
  bogOrder.orderId,
  "created",
  new Date().toISOString(),
  id
).run();

      return json({
        ok: true,
        reservationId: id,
        depositRequired: true,
        depositAmount,
        redirectUrl: bogOrder.redirectUrl,
      });
    } catch (bogError) {
      await DB.prepare(`
        UPDATE reservations
        SET
          status = ?,
          payment_status = ?,
          payment_provider = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        "payment_failed",
        "rejected",
        "bog",
        new Date().toISOString(),
        id
      ).run();

      return json(
        {
          ok: false,
          error: "Failed to initialize payment.",
          details: String(bogError?.message || bogError),
        },
        500
      );
    }
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Server error.",
        details: String(error),
      },
      500
    );
  }
}