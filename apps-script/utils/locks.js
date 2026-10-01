function withScriptLock(fn, timeoutMs) {
  var timeout = timeoutMs || 10000;
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(timeout);
  } catch (error) {
    throw appError('CONFLICT', 'The request could not get a lock in time.');
  }
  if (!acquired) throw appError('CONFLICT', 'The request could not get a lock in time.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
