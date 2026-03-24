export async function onRequestGet(context) {
  try {
    const body = await context.request.json();

    const tokenData = await getBogAccessToken(context.env);
    const accessToken = tokenData.access_token;

    const origin = new URL(context.request.url).origin;

    const payload = {
      external_order_id: crypto.randomUUID(),
      amount: body.amount || 150,
      currency: "GEL",
      description: "Reserve Restaurant deposit",

      callback_url: `${origin}/api/bog/callback`,
      success_url: `${origin}/reservation-success.html`,
      fail_url: `${origin}/reservation-failed.html`,

      customer: {
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
        phone: body.phone,
      },

      metadata: {
        booking_date: body.booking_date,
        booking_time: body.booking_time,
        guests: body.guests,
      },
    };

    const response = await fetch("https://api.bog.ge/payments/v1/ecommerce/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: data
      }), { status: 500 });
    }

    const redirectUrl =
      data.redirect_url ||
      data.links?.redirect ||
      data.payment_url;

    return new Response(JSON.stringify({
      ok: true,
      redirectUrl
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err.message
    }), { status: 500 });
  }
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

  const data = await response.json();
  return data;
}