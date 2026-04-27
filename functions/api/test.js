function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  try {
    const { RESEND_API_KEY } = context.env;

    if (!RESEND_API_KEY) {
      return json({ ok: false, error: "Missing RESEND_API_KEY" }, 500);
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Reserve Restaurant <info@reservetbilisi.ge>",
        to: "andreit2311@gmail.com",
        subject: "TEST – Reservation confirmation preview",
        html: `
          <div style="background:#f4f4f4; padding:32px 16px; font-family:Arial, sans-serif; color:#1a1a1a;">
            <div style="max-width:520px; margin:0 auto; background:#ffffff; padding:28px 24px; text-align:center;">

              <img
                src="https://reservetbilisi.ge/images/logoblack.svg"
                alt="Reserve Restaurant"
                style="width:220px; max-width:80%; margin:0 auto 28px; display:block;"
              />

              <p style="margin:0 0 14px; font-size:18px; color:#777;">
                Hello twin,
              </p>

              <h1 style="margin:0 0 18px; font-size:22px; color:#1a1a1a;">
                Your reservation is confirmed
              </h1>

              <p style="margin:0 0 18px; font-size:16px; line-height:1.6; color:#555;">
                Thank you for your reservation. Your table at Reserve has been confirmed.
              </p>

              <div style="margin:26px auto; padding:20px; border-top:1px solid #ddd; border-bottom:1px solid #ddd;">
                <p style="margin:0 0 10px; font-size:17px; font-weight:bold;">
                  Thursday, 16 April 2026
                </p>

                <p style="margin:0 0 10px; font-size:17px; font-weight:bold;">
                  2 guests · 20:00
                </p>

                <p style="margin:0; font-size:15px; color:#777;">
                  Deposit paid: 100 GEL
                </p>
              </div>

              <div style="margin:28px 0;">
                <h2 style="margin:0 0 12px; font-size:16px;">
                  Special requests
                </h2>

                <p style="margin:0; font-size:15px; line-height:1.6; color:#666;">
                  Window seat if possible
                </p>
              </div>

              <div style="margin:34px 0;">
                <h2 style="margin:0 0 12px; font-size:16px;">
                  Changes or cancellations
                </h2>

                <p style="margin:0 0 14px; font-size:15px; line-height:1.6; color:#666;">
                  For any changes, delays, or cancellations, please contact us in advance by phone or WhatsApp.
                </p>

                <a
                  href="https://api.whatsapp.com/send/?phone=%2B995595313344&text=&type=phone_number&app_absent=0"
                  style="color:#d0842f; font-size:16px; font-weight:bold; text-decoration:none;"
                >
                  +995 595 31 33 44
                </a>
              </div>

              <div style="margin:34px 0 10px;">
                <h2 style="margin:0 0 12px; font-size:16px;">
                  Contact
                </h2>

                <p style="margin:0 0 6px; font-size:15px; color:#666;">
                  3 9 Aprili St, Tbilisi
                </p>

                <a
                  href="mailto:info@reservetbilisi.ge"
                  style="color:#d0842f; font-size:15px; text-decoration:none;"
                >
                  info@reservetbilisi.ge
                </a>
              </div>

              <p style="margin:34px 0 0; font-size:15px; line-height:1.6; color:#777;">
                We look forward to welcoming you.
              </p>

              <p style="margin:20px 0 0; font-size:14px; color:#999;">
                Reserve Restaurant
              </p>

            </div>
          </div>
        `,
      }),
    });

    const result = await emailResponse.text();

    return json({
      ok: emailResponse.ok,
      status: emailResponse.status,
      response: result,
    });
  } catch (err) {
    return json({
      ok: false,
      error: String(err?.message || err),
    }, 500);
  }
}