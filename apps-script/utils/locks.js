// Apps Script script locks are not reentrant. Identity writes can run inside
// the existing idempotency lock, so a nested call reuses the lock already held
// by this execution. Each execution has its own depth; LockService still
// serializes different executions.
var scriptLockDepth = 0;

function withScriptLock(fn, timeoutMs) {
  if (scriptLockDepth > 0) return fn();
  var timeout = timeoutMs || 10000;
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(timeout);
  } catch (error) {
    throw appError('CONFLICT', 'The request could not get a lock in time.');
  }
  if (!acquired) throw appError('CONFLICT', 'The request could not get a lock in time.');
  scriptLockDepth += 1;
  try {
    return fn();
  } finally {
    scriptLockDepth -= 1;
    lock.releaseLock();
  }
}
