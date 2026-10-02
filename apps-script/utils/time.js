function businessDate(date, timezone) {
  var value = date instanceof Date ? date : new Date();
  var zone = timezone || 'Asia/Kuala_Lumpur';
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    return Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function nowIso(date) {
  var value = date instanceof Date ? date : new Date();
  return value.toISOString();
}

function normalizeBusinessDate(input, timezone) {
  var text = String(input || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw appError('VALIDATION_ERROR', 'Business date must use YYYY-MM-DD.');
  }
  var parsed = new Date(text + 'T00:00:00+08:00');
  if (businessDate(parsed, timezone || 'Asia/Kuala_Lumpur') !== text) {
    throw appError('VALIDATION_ERROR', 'Business date is not a real calendar date.');
  }
  return text;
}
