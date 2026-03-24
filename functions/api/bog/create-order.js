export async function onRequestGet(context) {
  try {
    const body = {
      first_name: "Test",
      last_name: "User",
      email: "test@test.com",
      phone: "+995555123123",
      booking_date: "2026-03-20",
      booking_time: "18:00",
      guests: 6,
      amount: 150
    };

    const tokenData = await getBogAccessToken(context.env);
    const accessToken = tokenData.access_token;

    const origin = new URL(context.request.url).origin;

    const payload = {
      callback_url: `${origin}/api/bog/callback`,
      external_order_id: crypto.randomUUID(),
      purchase_units: {
        currency: "GEL",
        total_amount: body.amount,
        basket: [
          {
            product_id: "reservation-deposit",
            description: "Reserve Restaurant deposit",
            quantity: 1,
            unit_price: body.amount,
            total_price: body.amount
          }
        ]
      },
      redirect_urls: {
        success: `${origin}/reservation-success.html`,
        fail: `${origin}/reservation-failed.html`
      }
    };

    const response = await fetch("https://api.bog.ge/payments/v1/ecommerce/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "Accept-Language": "en"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: data
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        orderId: data.id,
        detailsUrl: data?._links?.details?.href || null,
        redirectUrl: data?._links?.redirect?.href || null,
        raw: data
      }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: String(err?.message || err)
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}

async function getBogAccessToken(env) {
  const tokenUrl = "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token";

  const basic = btoa(`${env.BOG_CLIENT_ID}:${env.BOG_CLIENT_SECRET}`);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`BOG token error: ${response.status} ${JSON.stringify(data)}`);
  }

  if (!data.access_token) {
    throw new Error(`BOG token missing access_token: ${JSON.stringify(data)}`);
  }

  return data;
}