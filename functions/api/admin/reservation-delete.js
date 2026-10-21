import { createUndoToken, snapshotGuard } from "./_undo.js";

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

    if (!id) {
      return json({ ok: false, error: "Missing reservation ID." }, 400);
    }

    let undo = null;
    let guard = { sql: "id = ?", values: [id] };
    if (body.undo === true) {
      const current = await DB.prepare("SELECT * FROM reservations WHERE id = ? LIMIT 1").bind(id).first();
      if (!current) return json({ ok: false, error: "Reservation not found." }, 404);
      undo = await createUndoToken(context.env, current, null);
      guard = snapshotGuard(current);
    }
    const result = await DB.prepare(`DELETE FROM reservations WHERE ${guard.sql}`)
      .bind(...guard.values)
      .run();

    if (undo && Number(result.meta?.changes) !== 1) return json({ ok: false, error: "This reservation changed. Refresh it before deleting." }, 409);
    return json({ ok: true, result, ...(undo ? { undo } : {}) });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to delete reservation.",
      details: String(error),
    }, 500);
  }
}
