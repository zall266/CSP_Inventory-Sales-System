// Ported from src/features/halal/halalModel.ts for Apps Script V8.

var HALAL_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
var HALAL_DOCUMENT_TYPES = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true
};

function normalizeManufacturerName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCertificateNo(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isHalalDateKey(value) {
  var text = value === undefined || value === null ? '' : String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  var parts = text.split('-');
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var day = Number(parts[2]);
  var date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function findManufacturerByName(manufacturers, name, excludeId) {
  var needle = normalizeManufacturerName(name);
  if (!needle) return null;
  var found = null;
  (manufacturers || []).forEach(function (item) {
    if (item.id !== excludeId && normalizeManufacturerName(item.name) === needle) found = item;
  });
  return found;
}

function certificatePeriodMatches(certificate, input) {
  return (
    normalizeCertificateNo(certificate.certificateNo) === normalizeCertificateNo(input.certificateNo) &&
    String(certificate.issuingAuthority || '').trim().toLowerCase() === String(input.issuingAuthority || '').trim().toLowerCase() &&
    certificate.expiryDate === input.expiryDate &&
    (certificate.issueDate || '') === (input.issueDate || '')
  );
}

function findCertificateByPeriod(certificates, input, excludeId) {
  var found = null;
  (certificates || []).forEach(function (item) {
    if (item.id !== excludeId && certificatePeriodMatches(item, input)) found = item;
  });
  return found;
}

function validateHalalDocumentMeta(file) {
  var name = String(file && file.name ? file.name : '').toLowerCase();
  var extOk = name.slice(-4) === '.pdf' || name.slice(-4) === '.jpg' || name.slice(-5) === '.jpeg' || name.slice(-4) === '.png';
  var type = file && file.type === 'image/jpg' ? 'image/jpeg' : String(file && file.type ? file.type : '');
  if (Number(file && file.size) > HALAL_DOCUMENT_MAX_BYTES) return 'Certificate document must be 5 MB or smaller.';
  if (HALAL_DOCUMENT_TYPES[type] || ((!type || type === 'application/octet-stream') && extOk)) return '';
  return 'Upload a PDF, JPG, or PNG certificate.';
}

function parseHalalDocument(value, fileName, mimeType) {
  var text = String(value || '');
  var match = text.match(/^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return { ok: false, error: 'Upload a PDF, JPG, or PNG certificate.' };
  var mime = (mimeType || match[1] || '').toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  var b64 = match[2].replace(/\s/g, '');
  var padding = b64.slice(-2) === '==' ? 2 : b64.slice(-1) === '=' ? 1 : 0;
  var bytes = Math.floor((b64.length * 3) / 4) - padding;
  var name = String(fileName || '').trim() || 'halal-certificate.pdf';
  var error = validateHalalDocumentMeta({ name: name, type: mime, size: bytes });
  if (error) return { ok: false, error: error };
  return { ok: true, mime: mime, base64: b64, bytes: bytes, name: name };
}
