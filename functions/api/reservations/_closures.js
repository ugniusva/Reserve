import {
  BOOKING_DURATION_HOURS,
  RESTAURANT_TIMEZONE_OFFSET,
  bookingOverlaps,
  getRestaurantDate,
  isValidDate,
  parseDateTime,
} from "./_availability.js";

export const BOOKING_DURATION_MS = BOOKING_DURATION_HOURS * 60 * 60 * 1000;
export const CLOSED_BOOKING_MESSAGE = "This time is closed for reservations.";
const DAY_MS = 24 * 60 * 60 * 1000;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const overlapSql = "start_ms < ? AND end_ms > ?";

function localTime(date, time) {
  return Date.parse(`${date}T${time}:00${RESTAURANT_TIMEZONE_OFFSET}`);
}

export function closureWindow({ start_date, end_date, all_day, start_time, end_time }) {
  if (!isValidDate(start_date) || !isValidDate(end_date) || typeof all_day !== "boolean") return null;
  if (!all_day && (
    typeof start_time !== "string" || !timePattern.test(start_time) ||
    typeof end_time !== "string" || !timePattern.test(end_time)
  )) return null;
  const start = localTime(start_date, all_day ? "00:00" : start_time);
  const end = localTime(end_date, all_day ? "00:00" : end_time) + (all_day ? DAY_MS : 0);
  return end > start ? { start_ms: start, end_ms: end, all_day: Number(all_day) } : null;
}

export async function readBookingClosures(DB, firstDate, lastDate = firstDate) {
  const { results } = await DB.prepare(`
    SELECT start_ms, end_ms FROM booking_closures WHERE ${overlapSql}
  `).bind(localTime(lastDate, "00:00") + DAY_MS, localTime(firstDate, "00:00")).all();
  return results || [];
}

export async function readClosedDateRanges(DB, today) {
  const { results } = await DB.prepare(`
    SELECT start_ms, end_ms FROM booking_closures WHERE all_day = 1 AND end_ms > ? ORDER BY start_ms, end_ms
  `).bind(localTime(today, "00:00")).all();
  return (results || []).map(row => ({
    start_date: getRestaurantDate(new Date(row.start_ms)),
    end_date: getRestaurantDate(new Date(row.end_ms - 1)),
  }));
}

export function isClosedSlot(closures, date, time) {
  const start = parseDateTime(date, time).getTime();
  return closures.some(row => bookingOverlaps(start, start + BOOKING_DURATION_MS, row.start_ms, row.end_ms));
}

export function openBookingGuard(date, time) {
  const start = parseDateTime(date, time).getTime();
  return {
    sql: `NOT EXISTS (SELECT 1 FROM booking_closures WHERE ${overlapSql})`,
    values: [start + BOOKING_DURATION_MS, start],
  };
}

export async function bookingIsClosed(DB, guard) {
  const row = await DB.prepare(`SELECT ${guard.sql} AS is_open`).bind(...guard.values).first();
  return !Number(row?.is_open);
}
