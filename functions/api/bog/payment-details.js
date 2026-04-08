function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
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

export async function onRequestGet(context) {
  try {
    const { DB, BOG_CLIENT_ID, BOG_CLIENT_SECRET } = context.env;
    if (!DB || !BOG_CLIENT_ID || !BOG_CLIENT_SECRET) {
      return json({ ok: false, error: "Missing DB or BOG secrets." }, 500);
    }

    const url = new URL(context.request.url);
    const reservationId = (url.searchParams.get("reservationId") || "").trim();
    const orderIdParam = (url.searchParams.get("orderId") || "").trim();

    let orderId = orderIdParam;
    let reservation = null;

    if (reservationId) {
      reservation = await DB.prepare(`
        SELECT
          id,
          first_name,
          last_name,
          email,
          phone,
          booking_date,
          booking_time,
          guests,
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
        FROM reservations
        WHERE id = ?
        LIMIT 1
      `).bind(reservationId).first();

      if (!reservation) {
        return json({ ok: false, error: "Reservation not found." }, 404);
      }

      orderId = reservation.payment_order_id || "";
    }

    if (!orderId) {
      return json({ ok: false, error: "Missing reservationId or orderId." }, 400);
    }

    const accessToken = await getBogAccessToken(context.env);

    const response = await fetch(
      `https://api.bog.ge/payments/v1/receipt/${encodeURIComponent(orderId)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept-Language": "en",
        },
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return json(
        {
          ok: false,
          error: "BOG payment details request failed.",
          status: response.status,
          details: data,
          reservation,
        },
        500
      );
    }

    return json({
      ok: true,
      reservation,
      bog: data,
      useful: {
        order_status: data?.order_status?.key || null,
        order_status_text: data?.order_status?.value || null,
        reject_reason: data?.reject_reason || null,
        payment_code: data?.payment_detail?.code || null,
        payment_code_description: data?.payment_detail?.code_description || null,
        transaction_id: data?.payment_detail?.transaction_id || null,
        card_type: data?.payment_detail?.card_type || null,
        transfer_method: data?.payment_detail?.transfer_method?.key || null,
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Failed to fetch payment details.",
        details: String(error?.message || error),
      },
      500
    );
  }
}