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
    const status = String(body.status || "").trim();
    const guests = Number(body.guests);

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

    if (!allowedStatuses.includes(status)) {
      return json({ ok: false, error: "Invalid status." }, 400);
    }

    if (!Number.isInteger(guests) || guests < 1) {
      return json({ ok: false, error: "Invalid guest count." }, 400);
    }

    const updatedAt = new Date().toISOString();

    const result = await DB.prepare(`
      UPDATE reservations
      SET
        guests = ?,
        status = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      guests,
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