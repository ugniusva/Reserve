import { columnName, readUndoToken, snapshotGuard } from "./_undo.js";
import { adminAuthenticated } from "./_auth.js";
import { canFitCustomReservation } from "./_custom-reservation.js";
import { parseDateTime } from "../reservations/_availability.js";
import { occupiesCapacity, readCapacitySnapshot } from "../reservations/_capacity.js";
import { bookingIsClosed, BOOKING_DURATION_MS, openBookingGuard } from "../reservations/_closures.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost(context) {
  if (!(await adminAuthenticated(context.request, context.env))) return json({ ok: false, error: "Unauthorized" }, 401);
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
    const now = new Date();
    const confirmingHold = ["confirmed", "completed"].includes(before?.status) && !["confirmed", "completed"].includes(after?.status);
    const restoresSlot = !occupiesCapacity(after, now) || confirmingHold ||
      before?.booking_date !== after?.booking_date || before?.booking_time !== after?.booking_time;
    const capacityChanged = occupiesCapacity(before, now) && (restoresSlot || Number(before.guests) !== Number(after.guests));
    const start = before ? parseDateTime(before.booking_date, before.booking_time) : null;
    if (capacityChanged && start && start.getTime() + BOOKING_DURATION_MS > now.getTime()) {
      const needsOpenSlot = restoresSlot || Number(before.guests) > Number(after.guests);
      const opening = needsOpenSlot ? openBookingGuard(before.booking_date, before.booking_time) : { sql: "1 = 1", values: [] };
      if (needsOpenSlot && await bookingIsClosed(DB, opening)) {
        return json({ ok: false, error: "Cannot undo: the original time is closed. No changes were made." }, 409);
      }
      const { reservations, guard } = await readCapacitySnapshot(DB, before.booking_date, id, now);
      // Undo may restore an already-started booking; retain capacity rules, not the advance notice rule.
      const fit = canFitCustomReservation({ dateStr: before.booking_date, timeStr: before.booking_time, guests: Number(before.guests), reservations, now: new Date(start.getTime() - 3600000) });
      if (!fit.available) return json({ ok: false, error: "Cannot undo: the original time no longer has capacity. No changes were made." }, 409);
      extra = ` AND ${guard.sql} AND ${opening.sql}`;
      extraValues = [...guard.values, ...opening.values];
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
