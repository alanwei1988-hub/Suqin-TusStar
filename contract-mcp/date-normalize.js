const BEIJING_UTC_OFFSET_HOURS = 8;

function normalizeDateText(value) {
  if (value == null || value === '') {
    return null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split('.');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeTimestampText(value, { endOfDay = false } = {}) {
  if (value == null || value === '') {
    return null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return beijingDateTimeToUtcIso({
      year,
      month,
      day,
      hour: endOfDay ? 23 : 0,
      minute: endOfDay ? 59 : 0,
      second: endOfDay ? 59 : 0,
      millisecond: endOfDay ? 999 : 0,
    });
  }

  const naiveDateTime = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})(?::(\d{2}))?(?::(\d{2}))?(?:\.(\d{1,3}))?$/,
  );

  if (naiveDateTime) {
    const [, year, month, day, hour, minute = '00', second = '00', millisecond = '0'] = naiveDateTime;
    return beijingDateTimeToUtcIso({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
      millisecond: Number(millisecond.padEnd(3, '0')),
    });
  }

  if (/[zZ]$|[+\-]\d{2}:\d{2}$/.test(text)) {
    const parsed = new Date(text);

    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid timestamp: ${value}`);
    }

    return parsed.toISOString();
  }

  const parsed = new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }

  return parsed.toISOString();
}

module.exports = {
  normalizeDateText,
  normalizeTimestampText,
};

function beijingDateTimeToUtcIso({
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
}) {
  return new Date(Date.UTC(
    year,
    month - 1,
    day,
    hour - BEIJING_UTC_OFFSET_HOURS,
    minute,
    second,
    millisecond,
  )).toISOString();
}
