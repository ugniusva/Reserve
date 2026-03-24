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
        status: "paid",
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
    case "refunded":
    case "refunded_partially":
      return {
        status: "refunded",
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

async function updateReservationFromCallback(DB, payload) {
  const body = payload?.body || {};
  const orderId = body.order_id || null;
  const externalOrderId = body.external_order_id || null;
  const orderStatusKey = body?.order_status?.key || null;
  const transactionId = body?.payment_detail?.transaction_id || null;
  const nowIso = new Date().toISOString();

  const mapped = mapBogOrderStatus(orderStatusKey);
  const paidAt = mapped.paid ? nowIso : null;
  const payloadString = JSON.stringify(payload);

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
    updated: !!(result && result.meta && result.meta.changes > 0),
  };
}

export async function onRequestPost(context) {
  try {
    const { DB } = context.env;

    const signature = context.request.headers.get("Callback-Signature");
    const rawBody = await context.request.text();

    let signatureValid = false;
    if (signature) {
      try {
        signatureValid = await verifyBogCallbackSignature(rawBody, signature);
      } catch (err) {
        signatureValid = false;
      }
    }

    const payload = JSON.parse(rawBody);

    const updateResult = await updateReservationFromCallback(DB, payload);

    // Return 200 so BOG treats callback as received.
    return json({
      ok: true,
      signaturePresent: !!signature,
      signatureValid,
      updated: updateResult.updated,
      orderId: updateResult.orderId,
      externalOrderId: updateResult.externalOrderId,
      orderStatus: updateResult.orderStatusKey,
    }, 200);
  } catch (error) {
    // If parsing/storage fails, return non-200 so it’s visible and can be retried/checked.
    return json({
      ok: false,
      error: "Callback processing failed.",
      details: String(error?.message || error),
    }, 500);
  }
}