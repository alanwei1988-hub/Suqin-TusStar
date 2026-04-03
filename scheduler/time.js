const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function normalizeTimeZone(value) {
  const candidate = typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function normalizeWeekday(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return WEEKDAY_NAMES.includes(candidate)
    ? candidate
    : '';
}

function weekdayToIndex(value) {
  return WEEKDAY_NAMES.indexOf(normalizeWeekday(value));
}

function parseTimeOfDay(value) {
  const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    throw new Error(`Invalid timeOfDay. Expected HH:MM, received: ${value}`);
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    normalized: `${match[1]}:${match[2]}`,
  };
}

function getLocalDateTimeParts(value, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimeZone(timeZone),
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(value)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: normalizeWeekday(parts.weekday),
  };
}

function addDaysToCivilDate({ year, month, day }, deltaDays) {
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + deltaDays);

  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  };
}

function parseShortOffset(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (!normalized || normalized === 'GMT' || normalized === 'UTC') {
    return 0;
  }

  const match = normalized.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);

  if (!match) {
    return 0;
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  return sign * ((hours * 60) + minutes);
}

function getTimeZoneOffsetMinutes(value, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeTimeZone(timeZone),
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(value);
  const zoneName = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT';
  return parseShortOffset(zoneName);
}

function zonedCivilDateTimeToUtc({ year, month, day, hour, minute, timeZone }) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const localAsUtcMillis = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidateMillis = localAsUtcMillis;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(candidateMillis), normalizedTimeZone);
    const adjustedMillis = localAsUtcMillis - (offsetMinutes * 60 * 1000);

    if (adjustedMillis === candidateMillis) {
      break;
    }

    candidateMillis = adjustedMillis;
  }

  return new Date(candidateMillis);
}

function isLocalTimeReached(localNow, targetHour, targetMinute) {
  if (localNow.hour > targetHour) {
    return true;
  }

  if (localNow.hour < targetHour) {
    return false;
  }

  return localNow.minute >= targetMinute;
}

function computeNextRunAt(schedule, referenceDate = new Date()) {
  const scheduleType = String(schedule?.scheduleType || '').trim().toLowerCase();
  const timeZone = normalizeTimeZone(schedule?.timeZone || schedule?.timezone);
  const localNow = getLocalDateTimeParts(referenceDate, timeZone);
  const { hour, minute, normalized } = parseTimeOfDay(schedule?.timeOfDay);
  let targetDate = {
    year: localNow.year,
    month: localNow.month,
    day: localNow.day,
  };

  if (scheduleType === 'daily') {
    if (isLocalTimeReached(localNow, hour, minute)) {
      targetDate = addDaysToCivilDate(targetDate, 1);
    }
  } else if (scheduleType === 'weekly') {
    const targetWeekdayIndex = weekdayToIndex(schedule?.weekday);

    if (targetWeekdayIndex < 0) {
      throw new Error('Weekly schedules require a valid weekday.');
    }

    const currentWeekdayIndex = weekdayToIndex(localNow.weekday);
    let deltaDays = (targetWeekdayIndex - currentWeekdayIndex + 7) % 7;

    if (deltaDays === 0 && isLocalTimeReached(localNow, hour, minute)) {
      deltaDays = 7;
    }

    targetDate = addDaysToCivilDate(targetDate, deltaDays);
  } else {
    throw new Error(`Unsupported scheduleType: ${scheduleType}`);
  }

  return zonedCivilDateTimeToUtc({
    ...targetDate,
    hour,
    minute,
    timeZone,
  });
}

function formatDateTimeInTimeZone(value, timeZone) {
  const local = getLocalDateTimeParts(value, timeZone);
  const pad = number => String(number).padStart(2, '0');
  return `${local.year}-${pad(local.month)}-${pad(local.day)} ${pad(local.hour)}:${pad(local.minute)} (${normalizeTimeZone(timeZone)})`;
}

module.exports = {
  DEFAULT_TIMEZONE,
  WEEKDAY_NAMES,
  computeNextRunAt,
  formatDateTimeInTimeZone,
  getLocalDateTimeParts,
  normalizeTimeZone,
  normalizeWeekday,
  parseTimeOfDay,
  weekdayToIndex,
};
