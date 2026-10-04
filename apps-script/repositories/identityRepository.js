// Identity sheets from the master architecture. Created on first identity use.
// Sheet1, AuditLogs, Idempotency, and Counters are not redefined here.
// CompanyLogo is the single logo container under the existing Drive root.

var COMPANY_LOGO_FOLDER = 'CompanyLogo';
var LOGO_MAX_BYTES = 5 * 1024 * 1024;
var LOGO_MIME = {
  'image/png': true,
  'image/jpeg': true,
  'image/jpg': true,
  'image/webp': true,
  'image/svg+xml': true
};

var SETTINGS_HEADERS = [
  'id', 'businessName', 'legalName', 'logoUrl', 'logoFileId', 'logoFileName', 'phone', 'email', 'address',
  'website', 'registrationNo', 'bankName', 'bankAccount', 'paymentTerms', 'documentTerms', 'currency',
  'defaultWarehouseId', 'allowNegativeStock', 'costingMethod', 'batchTracking', 'expiryTracking',
  'defaultCustomerId', 'allowDiscount', 'allowReturns', 'enabledPaymentMethods'
];
var DEPARTMENT_HEADERS = ['id', 'name', 'status'];
var ROLE_HEADERS = ['id', 'name', 'description', 'status', 'protected', 'legacyRole', 'createdAt', 'updatedAt'];
var ROLE_PERMISSION_HEADERS = ['roleId', 'permissionKey', 'allowed'];
var USER_HEADERS = ['id', 'name', 'email', 'roleId', 'role', 'departmentId', 'status', 'lastLogin', 'createdAt', 'updatedAt'];
var USER_AUDIT_HEADERS = ['id', 'action', 'userId', 'userName', 'field', 'oldValue', 'newValue', 'changedBy', 'changedAt'];

var SETTINGS_STRINGS = [
  'businessName', 'legalName', 'phone', 'email', 'address', 'website', 'registrationNo', 'bankName',
  'bankAccount', 'paymentTerms', 'documentTerms', 'currency', 'defaultWarehouseId', 'defaultCustomerId'
];
var SETTINGS_BOOLEANS = ['allowNegativeStock', 'batchTracking', 'expiryTracking', 'allowDiscount', 'allowReturns'];
var PAYMENT_METHODS = { cash: true, bank_transfer: true, duitnow: true, card: true, ewallet: true };

function createIdentityRepository(sheetRepository, driveStorage) {
  function ensure(spreadsheet) {
    sheetRepository.ensureSheet(spreadsheet, 'Settings', SETTINGS_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'Departments', DEPARTMENT_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'Roles', ROLE_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'RolePermissions', ROLE_PERMISSION_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'Users', USER_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'UserAuditLogs', USER_AUDIT_HEADERS);
  }

  function sheet(spreadsheet, name) {
    return sheetRepository.getSheet(spreadsheet, name);
  }

  function asBool(value) {
    return value === true || value === 'TRUE' || value === 'true';
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function encodeBase64(bytes) {
    if (typeof Utilities !== 'undefined' && Utilities.base64Encode) return Utilities.base64Encode(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    throw appError('INTERNAL_ERROR', 'Base64 encoding is unavailable.');
  }

  function decodeBase64(value) {
    if (typeof Utilities !== 'undefined' && Utilities.base64Decode) return Utilities.base64Decode(value);
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
    throw appError('INTERNAL_ERROR', 'Base64 decoding is unavailable.');
  }

  function makeBlob(bytes, mime, name) {
    if (typeof Utilities !== 'undefined' && Utilities.newBlob) return Utilities.newBlob(bytes, mime, name);
    return {
      getBytes: function () { return bytes; },
      getContentType: function () { return mime; }
    };
  }

  function parseDataUrl(value) {
    var match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
    if (!match) return null;
    var bytes = decodeBase64(match[2].replace(/\s/g, ''));
    return { mime: match[1], bytes: bytes };
  }

  function storeLogo(previous, logoUrl) {
    var next = text(logoUrl);
    if (!next) {
      if (previous && previous.logoFileId) driveStorage.deleteFile(text(previous.logoFileId));
      return { logoUrl: '', logoFileId: '', logoFileName: '' };
    }
    if (next.indexOf('data:') !== 0) {
      if (next.length > 45000) throw appError('VALIDATION_ERROR', 'Logo must be 5 MB or smaller.');
      if (previous && previous.logoFileId) driveStorage.deleteFile(text(previous.logoFileId));
      return { logoUrl: next, logoFileId: '', logoFileName: '' };
    }
    var parsed = parseDataUrl(next);
    if (!parsed) throw appError('VALIDATION_ERROR', 'That file could not be read as an image.');
    if (!LOGO_MIME[parsed.mime]) throw appError('VALIDATION_ERROR', 'Use a PNG, JPG, WebP or SVG image.');
    var length = parsed.bytes.length || parsed.bytes.byteLength || 0;
    if (length > LOGO_MAX_BYTES) throw appError('VALIDATION_ERROR', 'Logo must be 5 MB or smaller.');
    driveStorage.createChildFolder(COMPANY_LOGO_FOLDER);
    var uploaded = driveStorage.uploadFile(COMPANY_LOGO_FOLDER, makeBlob(parsed.bytes, parsed.mime, 'company-logo'), 'company-logo');
    if (previous && previous.logoFileId && text(previous.logoFileId) !== uploaded.id) {
      driveStorage.deleteFile(text(previous.logoFileId));
    }
    return { logoUrl: '', logoFileId: uploaded.id, logoFileName: uploaded.name || 'company-logo' };
  }

  function logoDataUrl(row) {
    if (!row || !row.logoFileId) return text(row && row.logoUrl);
    var file = driveStorage.readFileBytes(text(row.logoFileId));
    return 'data:' + file.mimeType + ';base64,' + encodeBase64(file.bytes);
  }

  function readSettingsRow(spreadsheet) {
    var rows = sheetRepository.readObjects(sheet(spreadsheet, 'Settings'));
    for (var i = 0; i < rows.length; i += 1) {
      if (text(rows[i].id) === 'settings') return rows[i];
    }
    return null;
  }

  function readDepartments(spreadsheet) {
    return sheetRepository.readObjects(sheet(spreadsheet, 'Departments')).map(function (row) {
      return { id: text(row.id), name: text(row.name), status: text(row.status) === 'inactive' ? 'inactive' : 'active' };
    });
  }

  function readRoles(spreadsheet) {
    return sheetRepository.readObjects(sheet(spreadsheet, 'Roles')).map(function (row) {
      return {
        id: text(row.id),
        name: text(row.name),
        description: text(row.description),
        status: text(row.status) === 'inactive' ? 'inactive' : 'active',
        protected: asBool(row.protected),
        legacyRole: text(row.legacyRole),
        createdAt: text(row.createdAt),
        updatedAt: text(row.updatedAt)
      };
    });
  }

  function readUsers(spreadsheet) {
    return sheetRepository.readObjects(sheet(spreadsheet, 'Users')).map(function (row) {
      return {
        id: text(row.id),
        name: text(row.name),
        email: text(row.email),
        roleId: text(row.roleId),
        role: text(row.role),
        departmentId: text(row.departmentId),
        status: text(row.status) === 'inactive' ? 'inactive' : 'active',
        lastLogin: text(row.lastLogin),
        createdAt: text(row.createdAt),
        updatedAt: text(row.updatedAt)
      };
    });
  }

  function readAudits(spreadsheet) {
    return sheetRepository.readObjects(sheet(spreadsheet, 'UserAuditLogs')).map(function (row) {
      return {
        id: text(row.id),
        action: text(row.action),
        userId: text(row.userId),
        userName: text(row.userName),
        field: text(row.field),
        oldValue: text(row.oldValue),
        newValue: text(row.newValue),
        changedBy: text(row.changedBy),
        changedAt: text(row.changedAt)
      };
    });
  }

  function readMatrix(spreadsheet) {
    var matrix = {};
    sheetRepository.readObjects(sheet(spreadsheet, 'RolePermissions')).forEach(function (row) {
      var roleId = text(row.roleId);
      if (!roleId) return;
      if (!matrix[roleId]) matrix[roleId] = {};
      if (row.permissionKey) matrix[roleId][text(row.permissionKey)] = asBool(row.allowed);
    });
    return matrix;
  }

  function publicSettings(spreadsheet) {
    var row = readSettingsRow(spreadsheet);
    if (!row) return null;
    var settings = { roleMatrix: readMatrix(spreadsheet) };
    SETTINGS_STRINGS.forEach(function (key) { settings[key] = text(row[key]); });
    SETTINGS_BOOLEANS.forEach(function (key) { settings[key] = asBool(row[key]); });
    var costing = text(row.costingMethod);
    if (costing !== 'average' && costing !== 'fifo') {
      throw appError('VALIDATION_ERROR', 'Costing method is not valid.');
    }
    settings.costingMethod = costing;
    settings.logoUrl = logoDataUrl(row);
    try {
      var methods = JSON.parse(text(row.enabledPaymentMethods) || '[]');
      settings.enabledPaymentMethods = Array.isArray(methods) ? methods.map(text) : [];
    } catch (error) {
      throw appError('VALIDATION_ERROR', 'Enabled payment methods could not be read.');
    }
    return settings;
  }

  function load(spreadsheet) {
    ensure(spreadsheet);
    var users = readUsers(spreadsheet);
    return {
      empty: users.length === 0,
      users: users,
      roles: readRoles(spreadsheet),
      departments: readDepartments(spreadsheet),
      settings: publicSettings(spreadsheet),
      userAuditLogs: readAudits(spreadsheet)
    };
  }

  function writeMatrix(spreadsheet, matrix) {
    var rows = [];
    Object.keys(matrix || {}).forEach(function (roleId) {
      var permissions = normalizePermissions(matrix[roleId]);
      PERMISSION_KEYS.forEach(function (key) {
        rows.push({ roleId: roleId, permissionKey: key, allowed: permissions[key] });
      });
    });
    sheetRepository.replaceObjects(sheet(spreadsheet, 'RolePermissions'), rows);
  }

  function writeSettings(spreadsheet, settings, options) {
    var previous = readSettingsRow(spreadsheet);
    var keepLogo = options && options.keepLogo;
    var logo = keepLogo && previous
      ? { logoUrl: text(previous.logoUrl), logoFileId: text(previous.logoFileId), logoFileName: text(previous.logoFileName) }
      : storeLogo(previous, settings.logoUrl);
    var row = {
      id: 'settings',
      logoUrl: logo.logoUrl,
      logoFileId: logo.logoFileId,
      logoFileName: logo.logoFileName,
      costingMethod: settings.costingMethod,
      enabledPaymentMethods: JSON.stringify(settings.enabledPaymentMethods || [])
    };
    SETTINGS_STRINGS.forEach(function (key) { row[key] = text(settings[key]); });
    SETTINGS_BOOLEANS.forEach(function (key) { row[key] = Boolean(settings[key]); });
    sheetRepository.replaceObjects(sheet(spreadsheet, 'Settings'), [row]);
    writeMatrix(spreadsheet, settings.roleMatrix || {});
  }

  function writeDepartments(spreadsheet, departments) {
    sheetRepository.replaceObjects(sheet(spreadsheet, 'Departments'), departments);
  }

  function writeRoles(spreadsheet, roles) {
    sheetRepository.replaceObjects(sheet(spreadsheet, 'Roles'), roles);
  }

  function writeUsers(spreadsheet, users) {
    sheetRepository.replaceObjects(sheet(spreadsheet, 'Users'), users);
  }

  function writeAudits(spreadsheet, logs) {
    sheetRepository.replaceObjects(sheet(spreadsheet, 'UserAuditLogs'), logs);
  }

  return {
    ensure: ensure,
    load: load,
    readSettingsRow: readSettingsRow,
    writeSettings: writeSettings,
    writeDepartments: writeDepartments,
    writeRoles: writeRoles,
    writeUsers: writeUsers,
    writeAudits: writeAudits,
    writeMatrix: writeMatrix
  };
}
