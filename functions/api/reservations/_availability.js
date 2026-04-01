export const OPEN_TIME = "09:00";
export const CLOSE_TIME = "21:30";
export const SLOT_INTERVAL_MINUTES = 15;
export const MIN_ADVANCE_HOURS = 2;
export const BOOKING_DURATION_HOURS = 3;

export const MAX_CAPACITY = 22;
export const TWO_SEAT_TABLES = 5;
export const FOUR_SEAT_TABLES = 3;
export const MAX_GUESTS_PER_RESERVATION = 6;

export function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

export function isValidTimeSlotFormat(timeStr) {
  return /^([01]\d|2[0-3]):(00|15|30|45)$/.test(timeStr);
}

export function parseDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`);
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

export function tablesNeeded(guests) {
  const count = Number(guests);

  if (count >= 1 && count <= 2) {
    return { two: 1, four: 0, largeGroup: 0 };
  }

  if (count >= 3 && count <= 4) {
    return { two: 0, four: 1, largeGroup: 0 };
  }

  if (count >= 5 && count <= 6) {
    return { two: 1, four: 1, largeGroup: 1 };
  }

  throw new Error("Unsupported guest count.");
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

  const minAllowedStart = new Date(now.getTime() + MIN_ADVANCE_HOURS * 60 * 60 * 1000);
  if (slotStart.getTime() < minAllowedStart.getTime()) {
    return { available: false, reason: "min_advance" };
  }

  const slotEnd = addHours(slotStart, BOOKING_DURATION_HOURS);
  const requestedUsage = tablesNeeded(count);

  let usedGuests = 0;
  let usedTwo = 0;
  let usedFour = 0;
  let usedLargeGroups = 0;

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

    const existingUsage = tablesNeeded(Number(reservation.guests));

    usedGuests += Number(reservation.guests);
    usedTwo += existingUsage.two;
    usedFour += existingUsage.four;
    usedLargeGroups += existingUsage.largeGroup;
  }

  if (usedGuests + count > MAX_CAPACITY) {
    return { available: false, reason: "capacity" };
  }

  if (usedTwo + requestedUsage.two > TWO_SEAT_TABLES) {
    return { available: false, reason: "two_tables_full" };
  }

  if (usedFour + requestedUsage.four > FOUR_SEAT_TABLES) {
    return { available: false, reason: "four_tables_full" };
  }

  if (usedLargeGroups + requestedUsage.largeGroup > 1) {
    return { available: false, reason: "large_group_limit" };
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