import { adminAuthenticated } from "./_auth.js";
import { capacityStatusWhere, paymentHoldCutoff } from "../reservations/_capacity.js";
import { BOOKING_DURATION_MS, closureWindow } from "../reservations/_closures.js";
import { getRestaurantDate, RESTAURANT_TIMEZONE_OFFSET } from "../reservations/_availability.js";

const columns = "id, start_ms, end_ms, all_day, reason, version";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function conflictScope(window, now) {
  const start = `unixepoch(booking_date || 'T' || booking_time || ':00${RESTAURANT_TIMEZONE_OFFSET}') * 1000`;
  return {
    sql: `booking_date BETWEEN ? AND ?
      AND (${capacityStatusWhere()} OR status = 'payment_review')
      AND (${start}) < ? AND (${start}) + ? > ?`,
    values: [
      getRestaurantDate(new Date(window.start_ms - BOOKING_DURATION_MS)),
      getRestaurantDate(new Date(window.end_ms - 1)),
      paymentHoldCutoff(now),
      window.end_ms,
      BOOKING_DURATION_MS,
      window.start_ms,
    ],
  };
}

async function readConflicts(DB, scope) {
  const { results } = await DB.prepare(`
    SELECT id, first_name, last_name, booking_date, booking_time, guests, status
    FROM reservations WHERE ${scope.sql} ORDER BY booking_date, booking_time, id
  `).bind(...scope.values).all();
  return results || [];
}

function conflictResponse(conflicts) {
  return json({ ok: false, code: "closure_conflicts", error: "Review the affected reservations before saving.", conflicts }, 409);
}

export async function onRequestGet(context) {
  if (!(await adminAuthenticated(context.request, context.env))) return json({ ok: false, error: "Unauthorized" }, 401);
  try {
    const { results } = await context.env.DB.prepare(`
      SELECT ${columns} FROM booking_closures WHERE end_ms > ? ORDER BY start_ms, end_ms, id
    `).bind(Date.now()).all();
    return json({ ok: true, closures: results || [] });
  } catch {
    return json({ ok: false, error: "Could not load closures." }, 500);
  }
}

export async function onRequestPost(context) {
  if (!(await adminAuthenticated(context.request, context.env))) return json({ ok: false, error: "Unauthorized" }, 401);
  try {
    const { DB } = context.env;
    const body = await context.request.json().catch(() => null);
    if (!body || !["save", "remove"].includes(body.action)) return json({ ok: false, error: "Invalid closure action." }, 400);
    const editing = Object.hasOwn(body, "id");
    if ((editing || body.action === "remove") && (
      typeof body.id !== "string" || !body.id || !Number.isInteger(body.version) || body.version < 1
    )) return json({ ok: false, error: "Invalid closure record." }, 400);

    if (body.action === "remove") {
      const result = await DB.prepare("DELETE FROM booking_closures WHERE id = ? AND version = ?").bind(body.id, body.version).run();
      return Number(result.meta?.changes) === 1
        ? json({ ok: true })
        : json({ ok: false, error: "This closure has changed. Reopen Closures and try again." }, 409);
    }

    const now = new Date();
    const window = closureWindow(body);
    if (!window || window.end_ms <= now.getTime()) return json({ ok: false, error: "Choose a valid period ending in the future." }, 400);
    if (body.reason != null && (typeof body.reason !== "string" || body.reason.length > 160)) {
      return json({ ok: false, error: "Reason must be 160 characters or fewer." }, 400);
    }
    const reason = body.reason?.trim() || "";
    const accepted = new Set(Array.isArray(body.accepted_conflicts) ? body.accepted_conflicts : []);
    const scope = conflictScope(window, now);
    const conflicts = await readConflicts(DB, scope);
    if (conflicts.some(row => !accepted.has(row.id))) return conflictResponse(conflicts);

    // Require acknowledgement of bookings arriving between review and the write, too.
    const guard = `NOT EXISTS (
      SELECT 1 FROM reservations WHERE ${scope.sql}
      AND id NOT IN (SELECT value FROM json_each(?))
    )`;
    const values = [window.start_ms, window.end_ms, window.all_day, reason];
    const guardValues = [...scope.values, JSON.stringify(conflicts.map(row => row.id))];
    const saved = editing
      ? await DB.prepare(`
        UPDATE booking_closures SET start_ms = ?, end_ms = ?, all_day = ?, reason = ?, version = version + 1
        WHERE id = ? AND version = ? AND ${guard}
        RETURNING ${columns}
      `).bind(...values, body.id, body.version, ...guardValues).first()
      : await DB.prepare(`
        INSERT INTO booking_closures (id, start_ms, end_ms, all_day, reason)
        SELECT ?, ?, ?, ?, ? WHERE ${guard}
        RETURNING ${columns}
      `).bind(crypto.randomUUID(), ...values, ...guardValues).first();
    if (!saved) {
      const latest = await readConflicts(DB, scope);
      if (latest.some(row => !accepted.has(row.id))) return conflictResponse(latest);
      return json({ ok: false, error: "The closure or reservations changed. Reopen Closures and try again." }, 409);
    }
    return json({ ok: true, closure: saved });
  } catch {
    return json({ ok: false, error: "Could not save the closure." }, 500);
  }
}
