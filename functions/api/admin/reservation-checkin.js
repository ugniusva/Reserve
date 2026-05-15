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

function parseCheckedIn(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return null;
}

export async function onRequestPost(context) {
  try {
    if (!isAuthenticated(context.request)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const { DB } = context.env;
    const body = await context.request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const id = String(body.id || "").trim();
    const checkedIn = parseCheckedIn(body.checked_in);

    if (!id) {
      return json({ ok: false, error: "Missing reservation ID." }, 400);
    }

    if (checkedIn === null) {
      return json({ ok: false, error: "Invalid checked-in value." }, 400);
    }

    const current = await DB.prepare(`
      SELECT id
      FROM reservations
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

    if (!current) {
      return json({ ok: false, error: "Reservation not found." }, 404);
    }

    const updatedAt = new Date().toISOString();
    const checkedInAt = checkedIn ? updatedAt : null;
    const checkedInValue = checkedIn ? 1 : 0;

    const result = await DB.prepare(`
      UPDATE reservations
      SET
        checked_in = ?,
        checked_in_at = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      checkedInValue,
      checkedInAt,
      updatedAt,
      id
    ).run();

    return json({
      ok: true,
      reservation: {
        id,
        checked_in: checkedInValue,
        checked_in_at: checkedInAt,
        updated_at: updatedAt,
      },
      result,
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to update checked-in status.",
      details: String(error?.message || error),
    }, 500);
  }
}
