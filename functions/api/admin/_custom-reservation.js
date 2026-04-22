import {
  OPEN_TIME,
  CLOSE_TIME,
  parseDateTime,
  isValidDate,
  isValidTimeSlotFormat,
} from "../reservations/_availability.js";

export const CUSTOM_MAX_GUESTS = 22;
export const TWO_SEAT_TABLES = 5;
export const FOUR_SEAT_TABLES = 3;
export const SLOT_INTERVAL_MINUTES = 15;
export const MIN_ADVANCE_MS = 2 * 60 * 60 * 1000;
export const STAY_MS = 3 * 60 * 60 * 1000;

const optionCache = new Map();

export function getTimeSlots() {
  const slots = [];
  const startMinutes = parseTimeToMinutes(OPEN_TIME);
  const endMinutes = parseTimeToMinutes(CLOSE_TIME);

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += SLOT_INTERVAL_MINUTES) {
    slots.push(formatMinutesToTime(minutes));
  }

  return slots;
}

export function parseTimeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatMinutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function groupReservationsByDate(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    const key = row.booking_date;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  return grouped;
}

function overlaps(dateStr, leftTimeStr, rightDateStr, rightTimeStr) {
  const leftStart = parseDateTime(dateStr, leftTimeStr);
  const rightStart = parseDateTime(rightDateStr, rightTimeStr);

  if (Number.isNaN(leftStart.getTime()) || Number.isNaN(rightStart.getTime())) {
    return false;
  }

  const leftEnd = new Date(leftStart.getTime() + STAY_MS);
  const rightEnd = new Date(rightStart.getTime() + STAY_MS);

  return leftStart < rightEnd && rightStart < leftEnd;
}

function buildAllocationOptions(guests) {
  if (optionCache.has(guests)) {
    return optionCache.get(guests);
  }

  const result = [];
  const isLargeGroup = guests >= 5 && guests <= 6;

  if (!Number.isInteger(guests) || guests < 1 || guests > CUSTOM_MAX_GUESTS) {
    optionCache.set(guests, result);
    return result;
  }

  if (guests <= 2) {
    result.push({ twos: 1, fours: 0, seats: 2, waste: 2 - guests });
    optionCache.set(guests, result);
    return result;
  }

  if (guests <= 4) {
    result.push({ twos: 0, fours: 1, seats: 4, waste: 4 - guests });
    optionCache.set(guests, result);
    return result;
  }

  if (isLargeGroup) {
    result.push({ twos: 1, fours: 1, seats: 6, waste: 6 - guests });
    optionCache.set(guests, result);
    return result;
  }

  const seen = new Set();

  for (let fours = 0; fours <= FOUR_SEAT_TABLES; fours += 1) {
    for (let twos = 0; twos <= TWO_SEAT_TABLES; twos += 1) {
      if (fours === 0 && twos === 0) continue;

      const seats = (fours * 4) + (twos * 2);
      if (seats < guests) continue;

      const key = `${twos}:${fours}`;
      if (seen.has(key)) continue;
      seen.add(key);

      result.push({
        twos,
        fours,
        seats,
        waste: seats - guests,
      });
    }
  }

  result.sort((a, b) => {
    if (a.waste !== b.waste) return a.waste - b.waste;
    const aTables = a.twos + a.fours;
    const bTables = b.twos + b.fours;
    if (aTables !== bTables) return aTables - bTables;
    return b.fours - a.fours;
  });

  optionCache.set(guests, result);
  return result;
}

function canAssignGuestCounts(guestCounts) {
  const counts = guestCounts
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= CUSTOM_MAX_GUESTS)
    .sort((a, b) => b - a);

  const memo = new Map();

  function backtrack(index, twosLeft, foursLeft) {
    if (index >= counts.length) return true;

    const memoKey = `${index}|${twosLeft}|${foursLeft}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const guests = counts[index];
    const options = buildAllocationOptions(guests);

    for (const option of options) {
      if (option.twos > twosLeft || option.fours > foursLeft) {
        continue;
      }

      if (backtrack(index + 1, twosLeft - option.twos, foursLeft - option.fours)) {
        memo.set(memoKey, true);
        return true;
      }
    }

    memo.set(memoKey, false);
    return false;
  }

  return backtrack(0, TWO_SEAT_TABLES, FOUR_SEAT_TABLES);
}

export function canFitCustomReservation({
  dateStr,
  timeStr,
  guests,
  reservations,
  now = new Date(),
}) {
  if (!Number.isInteger(guests) || guests < 1 || guests > CUSTOM_MAX_GUESTS) {
    return { available: false, reason: "invalid_guests" };
  }

  if (!isValidDate(dateStr)) {
    return { available: false, reason: "invalid_date" };
  }

  if (!isValidTimeSlotFormat(timeStr)) {
    return { available: false, reason: "invalid_time" };
  }

  if (timeStr < OPEN_TIME || timeStr > CLOSE_TIME) {
    return { available: false, reason: "invalid_time" };
  }

  const selectedDateTime = parseDateTime(dateStr, timeStr);

  if (Number.isNaN(selectedDateTime.getTime())) {
    return { available: false, reason: "invalid_datetime" };
  }

  if ((selectedDateTime.getTime() - now.getTime()) < MIN_ADVANCE_MS) {
    return { available: false, reason: "min_advance" };
  }

  const overlappingGuestCounts = [];

  for (const row of reservations || []) {
    const rowGuests = Number(row.guests);
    if (!Number.isInteger(rowGuests) || rowGuests < 1 || rowGuests > CUSTOM_MAX_GUESTS) {
      continue;
    }

    if (!overlaps(dateStr, timeStr, row.booking_date || dateStr, row.booking_time)) {
      continue;
    }

    overlappingGuestCounts.push(rowGuests);
  }

  if (
    guests >= 5 &&
    guests <= 6 &&
    overlappingGuestCounts.some((value) => value >= 5 && value <= 6)
  ) {
    return { available: false, reason: "large_group_limit" };
  }

  const canSeat = canAssignGuestCounts([...overlappingGuestCounts, guests]);

  if (!canSeat) {
    return { available: false, reason: "capacity" };
  }

  return { available: true };
}