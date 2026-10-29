export const PAYMENT_HOLD_MINUTES = 15;
export const MAX_CHECKOUT_SETUP_MS = 3 * 60 * 1000;
const CALLBACK_GRACE_MINUTES = 2;
export const CHECKOUT_TTL_MINUTES = PAYMENT_HOLD_MINUTES - MAX_CHECKOUT_SETUP_MS / 60000 - CALLBACK_GRACE_MINUTES;
export const CAPACITY_WRITE_ATTEMPTS = 3;

const snapshotColumns = [
  "id", "booking_date", "booking_time", "guests", "status", "payment_provider", "created_at",
];
const occupancyColumns = ["id", "booking_date", "booking_time", "guests"];

export function occupiesCapacity(row, now = new Date()) {
  if (!row) return false;
  if (row.status === "confirmed" || row.status === "completed") return true;
  return row.status === "pending_payment" && row.payment_provider === "bog" &&
    Date.parse(row.created_at) > now.getTime() - PAYMENT_HOLD_MINUTES * 60000;
}

export function paymentHoldCutoff(now = new Date()) {
  return new Date(now.getTime() - PAYMENT_HOLD_MINUTES * 60000).toISOString();
}

export function capacityStatusWhere(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `(
    ${prefix}status IN ('confirmed', 'completed') OR (
      ${prefix}status = 'pending_payment' AND ${prefix}payment_provider = 'bog'
      AND julianday(${prefix}created_at) > julianday(?)
    )
  )`;
}

function capacityWhere(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}booking_date = ? AND ${prefix}id IS NOT ? AND ${capacityStatusWhere(alias)}`;
}

export async function readCapacitySnapshot(DB, date, excludeId = null, now = new Date()) {
  const values = [date, excludeId, paymentHoldCutoff(now)];
  const result = await DB.prepare(`
    SELECT ${snapshotColumns.join(", ")}
    FROM reservations
    WHERE ${capacityWhere()}
  `).bind(...values).all();
  const reservations = result.results || [];

  // Match active membership and table usage, not payment metadata. A hold being
  // confirmed still occupies the same tables and must not block other callbacks.
  const guard = {
    sql: `(SELECT COUNT(*) FROM reservations WHERE ${capacityWhere()}) = ?
      AND NOT EXISTS (
        SELECT 1 FROM reservations occupied
        WHERE ${capacityWhere("occupied")}
          AND NOT EXISTS (
            SELECT 1 FROM json_each(?) expected
            WHERE ${occupancyColumns.map(column => `occupied.${column} IS json_extract(expected.value, '$.${column}')`).join(" AND ")}
          )
      )`,
    values: [...values, reservations.length, ...values, JSON.stringify(reservations)],
  };

  return { reservations, guard };
}
