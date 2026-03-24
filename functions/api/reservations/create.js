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

async function getBogAccessToken(env) {
  const tokenUrl = "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token";

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
  };

  const response = await fetch("https://api.bog.ge/payments/v1/ecommerce/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "Accept-Language": "en",
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
    raw: data,
  };
}

export async function onRequestPost(context) {
  try {
    const { DB } = context.env;
    const body = await context.request.json();

    const firstName = (body.first_name || "").trim();
    const lastName = (body.last_name || "").trim();
    const email = (body.email || "").trim();
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

    const depositRequired = true;
    const depositAmount = 100;

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
          payment_ref = ?,
          payment_order_id = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        "bog",
        bogOrder.detailsUrl,
        bogOrder.orderId,
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
          payment_provider = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        "payment_init_failed",
        "bog",
        new Date().toISOString(),
        id
      ).run();

      return json({
        ok: false,
        error: "Failed to initialize payment.",
        details: String(bogError?.message || bogError),
      }, 500);
    }
  } catch (error) {
    return json({
      ok: false,
      error: "Server error.",
      details: String(error),
    }, 500);
  }
}