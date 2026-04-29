function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isAuthenticated(request) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.includes("admin_auth=ok");
}

export async function onRequestPost(context) {
  try {
    if (!isAuthenticated(context.request)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const { DB } = context.env;
    const body = await context.request.json();

    const id = String(body.id || "").trim();
    const firstName = String(body.first_name || "").trim();
    const lastName = String(body.last_name || "").trim();
    const phone = String(body.phone || "").trim();
    const guests = Number(body.guests);
    const tableNumber = String(body.table_number || "").trim(); // <-- NEW
    const status = String(body.status || "").trim();

    const allowedStatuses = [
      "pending_payment",
      "confirmed",
      "payment_failed",
      "cancelled",
      "completed",
      "no_show",
    ];

    if (!id) {
      return json({ ok: false, error: "Missing reservation ID." }, 400);
    }

    if (!firstName || !lastName) {
      return json({ ok: false, error: "Name is required." }, 400);
    }

    if (!phone) {
      return json({ ok: false, error: "Phone is required." }, 400);
    }

    if (!Number.isInteger(guests) || guests < 1) {
      return json({ ok: false, error: "Invalid guest count." }, 400);
    }

    if (!allowedStatuses.includes(status)) {
      return json({ ok: false, error: "Invalid status." }, 400);
    }

    const updatedAt = new Date().toISOString();

    const result = await DB.prepare(`
      UPDATE reservations
      SET
        first_name = ?,
        last_name = ?,
        phone = ?,
        guests = ?,
        table_number = ?,  -- NEW
        status = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      firstName,
      lastName,
      phone,
      guests,
      tableNumber || null, // <-- NEW (null if empty)
      status,
      updatedAt,
      id
    ).run();

    return json({ ok: true, result });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to update reservation.",
      details: String(error),
    }, 500);
  }
}