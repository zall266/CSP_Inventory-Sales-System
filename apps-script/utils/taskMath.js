// Ported from src/features/tasks/taskModel.ts for Apps Script V8.

var TASK_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
var TASK_PHOTO_TYPES = { 'image/png': true, 'image/jpeg': true, 'image/webp': true };
var TASK_FREQUENCIES = { daily: true, weekly: true, monthly: true, annually: true, specific_date: true };
var TASK_PRIORITIES = { low: true, normal: true, high: true };
var TASK_PHOTO_REQUIREMENTS = { none: true, optional: true, required: true };

function taskPad(value) {
  return String(value).padStart(2, '0');
}

function taskYmd(y, m, d) {
  return y + '-' + taskPad(m) + '-' + taskPad(d);
}

function taskKlParts(at) {
  var date = at instanceof Date ? at : new Date(at);
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  }).formatToParts(date);
  function pick(type) {
    var found = '';
    parts.forEach(function (part) {
      if (part.type === type) found = part.value;
    });
    return found;
  }
  var weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(pick('year')),
    m: Number(pick('month')),
    d: Number(pick('day')),
    weekday: weekdayMap[pick('weekday')] != null ? weekdayMap[pick('weekday')] : 0
  };
}

function addTaskCalendarDays(y, m, d, days) {
  var next = new Date(Date.UTC(y, m - 1, d + days));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

function daysInTaskMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function clampTaskMonthDay(y, m, day) {
  var max = daysInTaskMonth(y, m);
  var value = Number(day);
  if (!(value >= 1)) return 1;
  return value > max ? max : value;
}

function parseTaskTime(value) {
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  var match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? match[1] + ':' + match[2] : null;
}

function taskDueIso(y, m, d, time) {
  if (time) return taskYmd(y, m, d) + 'T' + time + ':00+08:00';
  return taskYmd(y, m, d) + 'T23:59:59+08:00';
}

function mondayIndex(weekday) {
  return (weekday + 6) % 7;
}

function currentTaskPeriod(task, now) {
  var today = taskKlParts(now);
  var time = task.time || '';
  if (task.frequency === 'daily') {
    var key = taskYmd(today.y, today.m, today.d);
    return { periodKey: 'd:' + key, dueAt: taskDueIso(today.y, today.m, today.d, time), ymd: key };
  }
  if (task.frequency === 'weekly') {
    var weekDay = Number.isFinite(Number(task.weekDay)) ? Number(task.weekDay) : 1;
    var weekStart = addTaskCalendarDays(today.y, today.m, today.d, -mondayIndex(today.weekday));
    var offset = weekDay === 0 ? 6 : weekDay - 1;
    var due = addTaskCalendarDays(weekStart.y, weekStart.m, weekStart.d, offset);
    var weekKey = taskYmd(due.y, due.m, due.d);
    return { periodKey: 'w:' + weekKey, dueAt: taskDueIso(due.y, due.m, due.d, time), ymd: weekKey };
  }
  if (task.frequency === 'monthly') {
    var day = clampTaskMonthDay(today.y, today.m, task.monthDay || 1);
    var monthKey = today.y + '-' + taskPad(today.m);
    return { periodKey: 'm:' + monthKey, dueAt: taskDueIso(today.y, today.m, day, time), ymd: taskYmd(today.y, today.m, day) };
  }
  if (task.frequency === 'annually') {
    var month = Math.min(12, Math.max(1, task.annualMonth || 1));
    var annualDay = clampTaskMonthDay(today.y, month, task.annualDay || 1);
    return { periodKey: 'y:' + today.y, dueAt: taskDueIso(today.y, month, annualDay, time), ymd: taskYmd(today.y, month, annualDay) };
  }
  var specific = String(task.specificDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(specific)) return null;
  var parts = specific.split('-').map(Number);
  return { periodKey: 's:' + specific, dueAt: taskDueIso(parts[0], parts[1], parts[2], time), ymd: specific };
}

function previousTaskPeriod(task, now) {
  if (task.frequency === 'specific_date') return null;
  var today = taskKlParts(now);
  var time = task.time || '';
  if (task.frequency === 'daily') {
    var prev = addTaskCalendarDays(today.y, today.m, today.d, -1);
    var key = taskYmd(prev.y, prev.m, prev.d);
    return { periodKey: 'd:' + key, dueAt: taskDueIso(prev.y, prev.m, prev.d, time), ymd: key };
  }
  if (task.frequency === 'weekly') {
    var current = currentTaskPeriod(task, now);
    if (!current) return null;
    var ymdParts = current.ymd.split('-').map(Number);
    var weekPrev = addTaskCalendarDays(ymdParts[0], ymdParts[1], ymdParts[2], -7);
    var weekKey = taskYmd(weekPrev.y, weekPrev.m, weekPrev.d);
    return { periodKey: 'w:' + weekKey, dueAt: taskDueIso(weekPrev.y, weekPrev.m, weekPrev.d, time), ymd: weekKey };
  }
  if (task.frequency === 'monthly') {
    var prevMonth = today.m === 1 ? { y: today.y - 1, m: 12 } : { y: today.y, m: today.m - 1 };
    var monthDay = clampTaskMonthDay(prevMonth.y, prevMonth.m, task.monthDay || 1);
    var monthKey = prevMonth.y + '-' + taskPad(prevMonth.m);
    return { periodKey: 'm:' + monthKey, dueAt: taskDueIso(prevMonth.y, prevMonth.m, monthDay, time), ymd: taskYmd(prevMonth.y, prevMonth.m, monthDay) };
  }
  var year = today.y - 1;
  var annualMonth = Math.min(12, Math.max(1, task.annualMonth || 1));
  var annualDay = clampTaskMonthDay(year, annualMonth, task.annualDay || 1);
  return { periodKey: 'y:' + year, dueAt: taskDueIso(year, annualMonth, annualDay, time), ymd: taskYmd(year, annualMonth, annualDay) };
}

function periodsToEnsure(task, now) {
  var current = currentTaskPeriod(task, now);
  var clock = now instanceof Date ? now : new Date(now);
  var periods = [];
  if (current) periods.push(current);
  var previous = previousTaskPeriod(task, now);
  if (previous && new Date(previous.dueAt).getTime() < clock.getTime()) {
    var exists = false;
    periods.forEach(function (row) {
      if (row.periodKey === previous.periodKey) exists = true;
    });
    if (!exists) periods.push(previous);
  }
  return periods;
}

function missingTaskOccurrences(tasks, existing, now, newIdFn) {
  var stamp = typeof now === 'string' ? now : now.toISOString();
  var extra = [];
  (tasks || []).forEach(function (task) {
    if (!task.active) return;
    periodsToEnsure(task, now).forEach(function (period) {
      var found = false;
      (existing || []).forEach(function (row) {
        if (row.taskId === task.id && row.periodKey === period.periodKey) found = true;
      });
      extra.forEach(function (row) {
        if (row.taskId === task.id && row.periodKey === period.periodKey) found = true;
      });
      if (!found) {
        extra.push({
          id: newIdFn ? newIdFn('tocc') : 'tocc_' + period.periodKey,
          taskId: task.id,
          periodKey: period.periodKey,
          dueAt: period.dueAt,
          status: 'pending',
          startedAt: '',
          completedBy: '',
          completedAt: '',
          completionNote: '',
          completionPhotoUrl: '',
          completionPhotoName: '',
          createdAt: stamp
        });
      }
    });
  });
  return extra.length ? (existing || []).concat(extra) : existing || [];
}

function parseTaskCompletionPhoto(value, fileName) {
  var text = String(value || '');
  if (text.indexOf('data:image/') !== 0) return { ok: false };
  var match = text.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return { ok: false };
  var mime = match[1].toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (!TASK_PHOTO_TYPES[mime]) return { ok: false };
  var b64 = match[2].replace(/\s/g, '');
  var padding = b64.slice(-2) === '==' ? 2 : b64.slice(-1) === '=' ? 1 : 0;
  var bytes = Math.floor((b64.length * 3) / 4) - padding;
  if (!(bytes > 0) || bytes > TASK_PHOTO_MAX_BYTES) return { ok: false };
  var extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  var name = String(fileName || '').trim() || ('task-photo.' + extension);
  return { ok: true, mime: mime, base64: b64, bytes: bytes, name: name, url: 'data:' + mime + ';base64,' + b64 };
}
