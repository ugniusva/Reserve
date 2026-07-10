export const OPEN_TIME = "12:00";
export const CLOSE_TIME = "21:30";
export const SLOT_INTERVAL_MINUTES = 15;
export const MIN_ADVANCE_HOURS = 1;
export const BOOKING_DURATION_HOURS = 2;
export const RESTAURANT_TIMEZONE_OFFSET = "+04:00";

export const MAX_CAPACITY = 22;
export const TWO_SEAT_TABLES = 5;
export const FOUR_SEAT_TABLES = 3;
export const MAX_GUESTS_PER_RESERVATION = 6;

const allocationOptionsCache = new Map();

export function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

export function isValidTimeSlotFormat(timeStr) {
  return /^([01]\d|2[0-3]):(00|15|30|45)$/.test(timeStr);
}

export function parseDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00${RESTAURANT_TIMEZONE_OFFSET}`);
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

export function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function getMinAllowedStart(now) {
  const currentMinute = new Date(now.getTime());
  currentMinute.setSeconds(0, 0);
  return addHours(currentMinute, MIN_ADVANCE_HOURS);
}

export function buildTimeSlots() {
  const slots = [];
  const startMinutes = parseTimeToMinutes(OPEN_TIME);
  const endMinutes = parseTimeToMinutes(CLOSE_TIME);

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += SLOT_INTERVAL_MINUTES) {
    slots.push(formatMinutesToTime(minutes));
  }

  return slots;
}

export function bookingOverlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function isLargeGroupCount(guests) {
  return guests >= 5 && guests <= 6;
}

function buildAllocationOptions(guests) {
  const count = Number(guests);

  if (allocationOptionsCache.has(count)) {
    return allocationOptionsCache.get(count);
  }

  const options = [];

  if (!Number.isInteger(count) || count < 1 || count > MAX_CAPACITY) {
    allocationOptionsCache.set(count, options);
    return options;
  }

  if (count <= 2) {
    options.push(
      { two: 1, four: 0, seats: 2, waste: 2 - count },
      { two: 0, four: 1, seats: 4, waste: 4 - count }
    );
    allocationOptionsCache.set(count, options);
    return options;
  }

  if (count <= 4) {
    options.push({ two: 0, four: 1, seats: 4, waste: 4 - count });
    allocationOptionsCache.set(count, options);
    return options;
  }

  if (count <= 6) {
    options.push({ two: 1, four: 1, seats: 6, waste: 6 - count });
    allocationOptionsCache.set(count, options);
    return options;
  }

  const seen = new Set();

  for (let four = 0; four <= FOUR_SEAT_TABLES; four += 1) {
    for (let two = 0; two <= TWO_SEAT_TABLES; two += 1) {
      if (two === 0 && four === 0) continue;

      const seats = (two * 2) + (four * 4);
      if (seats < count) continue;

      const key = `${two}:${four}`;
      if (seen.has(key)) continue;
      seen.add(key);

      options.push({
        two,
        four,
        seats,
        waste: seats - count,
      });
    }
  }

  options.sort((a, b) => {
    if (a.waste !== b.waste) return a.waste - b.waste;

    const aTables = a.two + a.four;
    const bTables = b.two + b.four;
    if (aTables !== bTables) return aTables - bTables;

    return b.four - a.four;
  });

  allocationOptionsCache.set(count, options);
  return options;
}

function canAssignGuestCounts(guestCounts) {
  const counts = guestCounts
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_CAPACITY)
    .sort((a, b) => b - a);

  if (counts.length !== guestCounts.length) {
    return false;
  }

  const memo = new Map();

  function backtrack(index, twosLeft, foursLeft) {
    if (index >= counts.length) return true;

    const memoKey = `${index}|${twosLeft}|${foursLeft}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const options = buildAllocationOptions(counts[index]);

    for (const option of options) {
      if (option.two > twosLeft || option.four > foursLeft) {
        continue;
      }

      if (backtrack(index + 1, twosLeft - option.two, foursLeft - option.four)) {
        memo.set(memoKey, true);
        return true;
      }
    }

    memo.set(memoKey, false);
    return false;
  }

  return backtrack(0, TWO_SEAT_TABLES, FOUR_SEAT_TABLES);
}

export function canFitReservation({
  dateStr,
  timeStr,
  guests,
  reservations,
  now = new Date(),
  excludeReservationId = null,
}) {
  const count = Number(guests);

  if (!isValidDate(dateStr)) {
    return { available: false, reason: "invalid_date" };
  }

  if (!isValidTimeSlotFormat(timeStr)) {
    return { available: false, reason: "invalid_time" };
  }

  if (!Number.isInteger(count) || count < 1 || count > MAX_GUESTS_PER_RESERVATION) {
    return { available: false, reason: "invalid_guests" };
  }

  const slotStart = parseDateTime(dateStr, timeStr);
  if (Number.isNaN(slotStart.getTime())) {
    return { available: false, reason: "invalid_datetime" };
  }

  const minAllowedStart = getMinAllowedStart(now);
  if (slotStart.getTime() < minAllowedStart.getTime()) {
    return { available: false, reason: "min_advance" };
  }

  const slotEnd = addHours(slotStart, BOOKING_DURATION_HOURS);
  const overlappingGuestCounts = [];

  for (const reservation of reservations) {
    if (excludeReservationId && reservation.id === excludeReservationId) {
      continue;
    }

    const existingStart = parseDateTime(reservation.booking_date, reservation.booking_time);
    if (Number.isNaN(existingStart.getTime())) {
      continue;
    }

    const existingEnd = addHours(existingStart, BOOKING_DURATION_HOURS);

    if (!bookingOverlaps(existingStart, existingEnd, slotStart, slotEnd)) {
      continue;
    }

    const existingGuests = Number(reservation.guests);
    if (!Number.isInteger(existingGuests) || existingGuests < 1 || existingGuests > MAX_CAPACITY) {
      continue;
    }

    overlappingGuestCounts.push(existingGuests);
  }

  const guestCounts = [...overlappingGuestCounts, count];
  const totalGuests = guestCounts.reduce((sum, value) => sum + value, 0);

  if (totalGuests > MAX_CAPACITY) {
    return { available: false, reason: "capacity" };
  }

  if (guestCounts.filter(isLargeGroupCount).length > 1) {
    return { available: false, reason: "large_group_limit" };
  }

  if (!canAssignGuestCounts(guestCounts)) {
    return { available: false, reason: "capacity" };
  }

  return {
    available: true,
    reason: null,
  };
}

export function buildDailyAvailability({ dateStr, guests, reservations, now = new Date() }) {
  return buildTimeSlots().map((time) => {
    const result = canFitReservation({
      dateStr,
      timeStr: time,
      guests,
      reservations,
      now,
    });

    return {
      time,
      available: result.available,
      reason: result.reason,
    };
  });
}
