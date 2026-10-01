function createId() {
  if (typeof Utilities !== 'undefined' && Utilities.getUuid) return Utilities.getUuid();
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  throw appError('INTERNAL_ERROR', 'UUID generation is unavailable.');
}
