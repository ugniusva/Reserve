import { adminAuthenticated, columnName, readUndoToken, snapshotGuard } from "./_undo.js";
import { canFitCustomReservation } from "./_custom-reservation.js";
import { parseDateTime, BOOKING_DURATION_HOURS } from "../reservations/_availability.js";

const active = row => row && ["confirmed", "completed"].includes(row.status);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost(context) {
  if (!adminAuthenticated(context.request)) return json({ ok: false, error: "Unauthorized" }, 401);
  try {
    const body = await context.request.json().catch(() => null);
    let payload;
    try { payload = await readUndoToken(context.env, body?.token); }
    catch { return json({ ok: false, error: "This undo record is invalid or expired. Refresh reservations." }, 400); }
    const { before, after } = payload;
    const { DB } = context.env;
    const id = (before || after).id;
    const schema = await DB.prepare("PRAGMA table_info(reservations)").all();
    const columns = new Set((schema.results || []).map(column => column.name));
    if ([before, after].filter(Boolean).some(row => Object.keys(row).some(key => !columns.has(key)))) {
      return json({ ok: false, error: "The reservation schema changed. This action cannot be undone safely." }, 409);
    }
    let extra = "", extraValues = [];
    const capacityChanged = active(before) && (!active(after) || before.booking_date !== after.booking_date || before.booking_time !== after.booking_time || Number(before.guests) !== Number(after.guests));
    const start = before ? parseDateTime(before.booking_date, before.booking_time) : null;
    if (capacityChanged && start && start.getTime() + BOOKING_DURATION_HOURS * 3600000 > Date.now()) {
      const rows = await DB.prepare("SELECT id, booking_date, booking_time, guests, status FROM reservations WHERE booking_date = ? AND status IN ('confirmed', 'completed') AND id <> ?").bind(before.booking_date, id).all();
      const reservations = rows.results || [];
      // Undo may restore an already-started booking; retain capacity rules, not the advance notice rule.
      const fit = canFitCustomReservation({ dateStr: before.booking_date, timeStr: before.booking_time, guests: Number(before.guests), reservations, now: new Date(start.getTime() - 3600000) });
      if (!fit.available) return json({ ok: false, error: "Cannot undo: the original time no longer has capacity. No changes were made." }, 409);
      // Guard the availability snapshot in the write itself, including concurrent new bookings.
      extra = " AND (SELECT COUNT(*) FROM reservations WHERE booking_date = ? AND status IN ('confirmed', 'completed') AND id <> ?) = ?";
      extraValues = [before.booking_date, id, reservations.length];
      extra += ` AND NOT EXISTS (
        SELECT 1 FROM reservations occupied
        WHERE occupied.booking_date = ? AND occupied.status IN ('confirmed', 'completed') AND occupied.id <> ?
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) expected
          WHERE occupied.id IS json_extract(expected.value, '$.id')
            AND occupied.booking_time IS json_extract(expected.value, '$.booking_time')
            AND occupied.guests IS json_extract(expected.value, '$.guests')
            AND occupied.status IS json_extract(expected.value, '$.status')
        )
      )`;
      extraValues.push(before.booking_date, id, JSON.stringify(reservations));
    }
    let result;
    if (!after) {
      const restored = { ...before, updated_at: new Date().toISOString() };
      const keys = Object.keys(restored);
      result = await DB.prepare(`INSERT INTO reservations (${keys.map(columnName).join(", ")}) SELECT ${keys.map(() => "?").join(", ")} WHERE NOT EXISTS (SELECT 1 FROM reservations WHERE id = ?)${extra}`).bind(...keys.map(key => restored[key]), id, ...extraValues).run();
    } else {
      const guard = snapshotGuard(after);
      if (!before) {
        result = await DB.prepare(`DELETE FROM reservations WHERE ${guard.sql}`).bind(...guard.values).run();
      } else {
        const restored = { ...before, updated_at: new Date().toISOString() };
        const keys = Object.keys(restored).filter(key => key !== "id");
        result = await DB.prepare(`UPDATE reservations SET ${keys.map(key => `${columnName(key)} = ?`).join(", ")} WHERE ${guard.sql}${extra}`).bind(...keys.map(key => restored[key]), ...guard.values, ...extraValues).run();
      }
    }
    if (Number(result.meta?.changes) !== 1) return json({ ok: false, error: "Cannot undo: this reservation or its availability changed. Refresh and review it first." }, 409);
    return json({ ok: true, id });
  } catch (error) {
    return json({ ok: false, error: "Undo could not be completed. Refresh reservations before trying again." }, 500);
  }
}
