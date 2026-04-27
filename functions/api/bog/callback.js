
import { Resend } from "resend";


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

// BOG callback verification public key from docs
const BOG_CALLBACK_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu4RUyAw3+CdkS3ZNILQh
zHI9Hemo+vKB9U2BSabppkKjzjjkf+0Sm76hSMiu/HFtYhqWOESryoCDJoqffY0Q
1VNt25aTxbj068QNUtnxQ7KQVLA+pG0smf+EBWlS1vBEAFbIas9d8c9b9sSEkTrr
TYQ90WIM8bGB6S/KLVoT1a7SnzabjoLc5Qf/SLDG5fu8dH8zckyeYKdRKSBJKvhx
tcBuHV4f7qsynQT+f2UYbESX/TLHwT5qFWZDHZ0YUOUIvb8n7JujVSGZO9/+ll/g
4ZIWhC1MlJgPObDwRkRd8NFOopgxMcMsDIZIoLbWKhHVq67hdbwpAq9K9WMmEhPn
PwIDAQAB
-----END PUBLIC KEY-----`;

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function importBogPublicKey() {
  return crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(BOG_CALLBACK_PUBLIC_KEY_PEM),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"]
  );
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function verifyBogCallbackSignature(rawBody, signatureBase64) {
  if (!signatureBase64) {
    return false;
  }

  const key = await importBogPublicKey();
  const encoder = new TextEncoder();

  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64ToArrayBuffer(signatureBase64),
    encoder.encode(rawBody)
  );
}

function mapBogOrderStatus(orderStatusKey) {
  switch (orderStatusKey) {
    case "completed":
      return {
        status: "confirmed",
        payment_status: "completed",
        paid: true,
      };

    case "rejected":
      return {
        status: "payment_failed",
        payment_status: "rejected",
        paid: false,
      };

    case "processing":
      return {
        status: "pending_payment",
        payment_status: "processing",
        paid: false,
      };

    case "created":
      return {
        status: "pending_payment",
        payment_status: "created",
        paid: false,
      };

    case "refund_requested":
      return {
        status: "confirmed",
        payment_status: "refund_requested",
        paid: true,
      };

    case "auth_requested":
      return {
        status: "pending_payment",
        payment_status: "auth_requested",
        paid: false,
      };

    case "refunded":
    case "refunded_partially":
      return {
        status: "cancelled",
        payment_status: orderStatusKey,
        paid: false,
      };

    default:
      return {
        status: "pending_payment",
        payment_status: orderStatusKey || "unknown",
        paid: false,
      };
  }
}

async function updateReservationFromCallback(DB, payload, rawBody) {
  const body = payload?.body || {};
  const orderId = body.order_id || null;
  const externalOrderId = body.external_order_id || null;
  const orderStatusKey = body?.order_status?.key || null;
  const transactionId = body?.payment_detail?.transaction_id || null;
  const nowIso = new Date().toISOString();

  const mapped = mapBogOrderStatus(orderStatusKey);
  const paidAt = mapped.paid ? nowIso : null;
  const payloadString = rawBody || JSON.stringify(payload);

  let result = null;

  if (externalOrderId) {
    result = await DB.prepare(`
      UPDATE reservations
      SET
        status = ?,
        payment_status = ?,
        payment_provider = ?,
        payment_ref = COALESCE(?, payment_ref),
        payment_order_id = COALESCE(?, payment_order_id),
        paid_at = COALESCE(?, paid_at),
        callback_received_at = ?,
        callback_payload = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      mapped.status,
      mapped.payment_status,
      "bog",
      transactionId,
      orderId,
      paidAt,
      nowIso,
      payloadString,
      nowIso,
      externalOrderId
    ).run();
  }

  if ((!result || !result.meta || result.meta.changes === 0) && orderId) {
    result = await DB.prepare(`
      UPDATE reservations
      SET
        status = ?,
        payment_status = ?,
        payment_provider = ?,
        payment_ref = COALESCE(?, payment_ref),
        payment_order_id = COALESCE(?, payment_order_id),
        paid_at = COALESCE(?, paid_at),
        callback_received_at = ?,
        callback_payload = ?,
        updated_at = ?
      WHERE payment_order_id = ?
    `).bind(
      mapped.status,
      mapped.payment_status,
      "bog",
      transactionId,
      orderId,
      paidAt,
      nowIso,
      payloadString,
      nowIso,
      orderId
    ).run();
  }

  return {
    orderId,
    externalOrderId,
    orderStatusKey,
    mappedStatus: mapped.status,
    mappedPaymentStatus: mapped.payment_status,
    updated: !!(result && result.meta && result.meta.changes > 0),
  };
}

export async function onRequestPost(context) {
  try {
    const { DB, RESEND_API_KEY } = context.env;

    const signature = context.request.headers.get("Callback-Signature");
    const rawBody = await context.request.text();

    if (!rawBody) {
      return json({ ok: false, error: "Empty callback body." }, 400);
    }

    let signatureValid = false;

    if (signature) {
      try {
        signatureValid = await verifyBogCallbackSignature(rawBody, signature);
      } catch (err) {
        signatureValid = false;
      }

      if (!signatureValid) {
        return json({ ok: false, error: "Invalid callback signature." }, 401);
      }
    }

    let payload = null;

    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      return json({
        ok: false,
        error: "Invalid callback JSON.",
        details: String(err?.message || err),
      }, 400);
    }

    const body = payload?.body || {};
    const orderId = body.order_id || null;
    const externalOrderId = body.external_order_id || null;
    const orderStatusKey = body?.order_status?.key || null;

    let reservationBefore = null;

    if (externalOrderId) {
      reservationBefore = await DB.prepare(`
        SELECT *
        FROM reservations
        WHERE id = ?
        LIMIT 1
      `).bind(externalOrderId).first();
    }

    if (!reservationBefore && orderId) {
      reservationBefore = await DB.prepare(`
        SELECT *
        FROM reservations
        WHERE payment_order_id = ?
        LIMIT 1
      `).bind(orderId).first();
    }

    const updateResult = await updateReservationFromCallback(DB, payload, rawBody);

    let emailSent = false;
    let emailError = null;

    const shouldSendEmail =
      orderStatusKey === "completed" &&
      reservationBefore &&
      reservationBefore.email &&
      reservationBefore.payment_status !== "completed" &&
      reservationBefore.status !== "confirmed";

    if (shouldSendEmail) {
      try {
        const escapeHtml = (value) =>
          String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

        const formatNiceDate = (dateStr) => {
          const date = new Date(`${dateStr}T00:00:00`);
          if (Number.isNaN(date.getTime())) return dateStr;

          return date.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          });
        };

        const firstName = escapeHtml(reservationBefore.first_name || "Guest");
        const bookingDate = escapeHtml(formatNiceDate(reservationBefore.booking_date));
        const bookingTime = escapeHtml(reservationBefore.booking_time);
        const guests = Number(reservationBefore.guests) || 0;
        const guestText = guests === 1 ? "1 guest" : `${guests} guests`;
        const depositAmount = Number(reservationBefore.deposit_amount) || 0;
        const requests = reservationBefore.requests
          ? escapeHtml(reservationBefore.requests)
          : "None provided";

        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Reserve Restaurant <info@reservetbilisi.ge>",
            to: reservationBefore.email,
            subject: "Your reservation at Reserve is confirmed",
            html: `
              <div style="background:#f4f4f4; padding:32px 16px; font-family:Arial, sans-serif; color:#1a1a1a;">
                <div style="max-width:520px; margin:0 auto; background:#ffffff; padding:28px 24px; text-align:center;">

                  <img
                    src="https://reservetbilisi.ge/images/logoblack.svg"
                    alt="Reserve Restaurant"
                    style="width:220px; max-width:80%; margin:0 auto 28px; display:block;"
                  />

                  <p style="margin:0 0 14px; font-size:18px; color:#777;">
                    Hello ${firstName},
                  </p>

                  <h1 style="margin:0 0 18px; font-size:22px; color:#1a1a1a;">
                    Your reservation is confirmed
                  </h1>

                  <p style="margin:0 0 18px; font-size:16px; line-height:1.6; color:#555;">
                    Thank you for your reservation. Your table at Reserve has been confirmed.
                  </p>

                  <div style="margin:26px auto; padding:20px; border-top:1px solid #ddd; border-bottom:1px solid #ddd;">
                    <p style="margin:0 0 10px; font-size:17px; font-weight:bold;">
                      ${bookingDate}
                    </p>

                    <p style="margin:0 0 10px; font-size:17px; font-weight:bold;">
                      ${escapeHtml(guestText)} · ${bookingTime}
                    </p>

                    <p style="margin:0; font-size:15px; color:#777;">
                      Deposit paid: ${depositAmount} GEL
                    </p>
                  </div>

                  <div style="margin:28px 0;">
                    <h2 style="margin:0 0 12px; font-size:16px;">
                      Special requests
                    </h2>

                    <p style="margin:0; font-size:15px; line-height:1.6; color:#666;">
                      ${requests}
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

        if (!emailResponse.ok) {
          const emailText = await emailResponse.text();
          throw new Error(emailText);
        }

        emailSent = true;
      } catch (err) {
        emailError = String(err?.message || err);
      }
    }

    return json({
      ok: true,
      signaturePresent: !!signature,
      signatureValid,
      updated: updateResult.updated,
      orderId: updateResult.orderId,
      externalOrderId: updateResult.externalOrderId,
      orderStatus: updateResult.orderStatusKey,
      mappedStatus: updateResult.mappedStatus,
      mappedPaymentStatus: updateResult.mappedPaymentStatus,
      emailSent,
      emailError,
    }, 200);
  } catch (error) {
    return json({
      ok: false,
      error: "Callback processing failed.",
      details: String(error?.message || error),
    }, 500);
  }
}