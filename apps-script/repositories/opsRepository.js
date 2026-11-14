// Module 17 Halal, staff tasks, and expenses tables.

var MANUFACTURER_HEADERS = [
  'id', 'name', 'registrationNo', 'address', 'contact', 'notes', 'active',
  'createdAt', 'createdBy', 'updatedAt', 'updatedBy'
];
var HALAL_CERTIFICATE_HEADERS = [
  'id', 'certificateNo', 'issuingAuthority', 'issueDate', 'expiryDate', 'verificationStatus',
  'verifiedAt', 'verifiedBy', 'documentFileId', 'documentName', 'documentMime', 'notes',
  'createdAt', 'createdBy', 'updatedAt', 'updatedBy'
];
var HALAL_COMPLIANCE_HEADERS = [
  'id', 'productId', 'manufacturerId', 'certificateId', 'previousCertificateIdsJson', 'notes',
  'createdAt', 'createdBy', 'updatedAt', 'updatedBy'
];
var TASK_CATEGORY_HEADERS = ['id', 'name', 'status', 'createdAt', 'updatedAt'];
var STAFF_TASK_HEADERS = [
  'id', 'title', 'description', 'categoryId', 'assignedTo', 'departmentId', 'priority',
  'frequency', 'weekDay', 'monthDay', 'annualMonth', 'annualDay', 'specificDate', 'time',
  'photoRequirement', 'active', 'referenceType', 'referenceId', 'referenceNo',
  'createdBy', 'createdAt', 'updatedAt'
];
var TASK_OCCURRENCE_HEADERS = [
  'id', 'taskId', 'periodKey', 'dueAt', 'status', 'startedAt', 'completedBy', 'completedAt',
  'completionNote', 'completionPhotoUrl', 'completionPhotoName', 'createdAt'
];
var EXPENSE_HEADERS = ['id', 'date', 'category', 'description', 'amount', 'paymentMethod', 'notes'];

function createOpsRepository(sheetRepository) {
  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function flag(value) {
    return value === true || value === 'true' || value === 'TRUE';
  }

  function optional(value) {
    var next = text(value).trim();
    return next || undefined;
  }

  function forceText(sheet, column) {
    if (!sheet || column < 1) return;
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

  function parseJson(value, fallback) {
    var raw = text(value).trim();
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function jsonCell(value) {
    if (value === undefined || value === null || value === '') return '';
    return JSON.stringify(value);
  }

  function ensureHalal(spreadsheet) {
    var manufacturers = sheetRepository.ensureSheet(spreadsheet, 'Manufacturers', MANUFACTURER_HEADERS);
    var certificates = sheetRepository.ensureSheet(spreadsheet, 'HalalCertificates', HALAL_CERTIFICATE_HEADERS);
    var compliances = sheetRepository.ensureSheet(spreadsheet, 'HalalCompliances', HALAL_COMPLIANCE_HEADERS);
    forceText(manufacturers, 1);
    forceText(certificates, 1);
    forceText(compliances, 1);
    return { manufacturers: manufacturers, certificates: certificates, compliances: compliances };
  }

  function ensureTasks(spreadsheet) {
    var categories = sheetRepository.ensureSheet(spreadsheet, 'StaffTaskCategories', TASK_CATEGORY_HEADERS);
    var tasks = sheetRepository.ensureSheet(spreadsheet, 'StaffTasks', STAFF_TASK_HEADERS);
    var occurrences = sheetRepository.ensureSheet(spreadsheet, 'StaffTaskOccurrences', TASK_OCCURRENCE_HEADERS);
    forceText(categories, 1);
    forceText(tasks, 1);
    forceText(occurrences, 1);
    return { categories: categories, tasks: tasks, occurrences: occurrences };
  }

  function ensureExpenses(spreadsheet) {
    var expenses = sheetRepository.ensureSheet(spreadsheet, 'Expenses', EXPENSE_HEADERS);
    forceText(expenses, 1);
    return { expenses: expenses };
  }

  function readManufacturers(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Manufacturers');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var item = {
        id: id,
        name: text(row.name).trim(),
        active: row.active === '' ? true : flag(row.active),
        createdAt: text(row.createdAt).trim(),
        createdBy: text(row.createdBy).trim(),
        updatedAt: text(row.updatedAt).trim(),
        updatedBy: text(row.updatedBy).trim()
      };
      var registrationNo = optional(row.registrationNo);
      var address = optional(row.address);
      var contact = optional(row.contact);
      var notes = optional(row.notes);
      if (registrationNo) item.registrationNo = registrationNo;
      if (address) item.address = address;
      if (contact) item.contact = contact;
      if (notes) item.notes = notes;
      return item;
    }).filter(Boolean);
  }

  function writeManufacturers(spreadsheet, rows) {
    ensureHalal(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Manufacturers'), (rows || []).map(function (row) {
      return {
        id: row.id,
        name: row.name,
        registrationNo: row.registrationNo || '',
        address: row.address || '',
        contact: row.contact || '',
        notes: row.notes || '',
        active: row.active !== false,
        createdAt: row.createdAt || '',
        createdBy: row.createdBy || '',
        updatedAt: row.updatedAt || '',
        updatedBy: row.updatedBy || ''
      };
    }));
  }

  function readCertificates(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'HalalCertificates');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var item = {
        id: id,
        certificateNo: text(row.certificateNo).trim(),
        issuingAuthority: text(row.issuingAuthority).trim(),
        expiryDate: text(row.expiryDate).trim(),
        verificationStatus: text(row.verificationStatus).trim() === 'verified' ? 'verified' : 'pending',
        createdAt: text(row.createdAt).trim(),
        createdBy: text(row.createdBy).trim(),
        updatedAt: text(row.updatedAt).trim(),
        updatedBy: text(row.updatedBy).trim()
      };
      var issueDate = optional(row.issueDate);
      var verifiedAt = optional(row.verifiedAt);
      var verifiedBy = optional(row.verifiedBy);
      var documentFileId = optional(row.documentFileId);
      var documentName = optional(row.documentName);
      var documentMime = optional(row.documentMime);
      var notes = optional(row.notes);
      if (issueDate) item.issueDate = issueDate;
      if (verifiedAt) item.verifiedAt = verifiedAt;
      if (verifiedBy) item.verifiedBy = verifiedBy;
      if (documentFileId) item.documentFileId = documentFileId;
      if (documentName) item.documentName = documentName;
      if (documentMime) item.documentMime = documentMime;
      if (notes) item.notes = notes;
      return item;
    }).filter(Boolean);
  }

  function writeCertificates(spreadsheet, rows) {
    ensureHalal(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'HalalCertificates'), (rows || []).map(function (row) {
      return {
        id: row.id,
        certificateNo: row.certificateNo,
        issuingAuthority: row.issuingAuthority,
        issueDate: row.issueDate || '',
        expiryDate: row.expiryDate,
        verificationStatus: row.verificationStatus,
        verifiedAt: row.verifiedAt || '',
        verifiedBy: row.verifiedBy || '',
        documentFileId: row.documentFileId || '',
        documentName: row.documentName || '',
        documentMime: row.documentMime || '',
        notes: row.notes || '',
        createdAt: row.createdAt || '',
        createdBy: row.createdBy || '',
        updatedAt: row.updatedAt || '',
        updatedBy: row.updatedBy || ''
      };
    }));
  }

  function readCompliances(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'HalalCompliances');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var ids = parseJson(row.previousCertificateIdsJson, []) || [];
      if (!Array.isArray(ids)) ids = [];
      var item = {
        id: id,
        productId: text(row.productId).trim(),
        manufacturerId: text(row.manufacturerId).trim(),
        certificateId: text(row.certificateId).trim(),
        previousCertificateIds: ids.map(function (value) { return text(value).trim(); }).filter(Boolean),
        createdAt: text(row.createdAt).trim(),
        createdBy: text(row.createdBy).trim(),
        updatedAt: text(row.updatedAt).trim(),
        updatedBy: text(row.updatedBy).trim()
      };
      var notes = optional(row.notes);
      if (notes) item.notes = notes;
      return item;
    }).filter(Boolean);
  }

  function writeCompliances(spreadsheet, rows) {
    ensureHalal(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'HalalCompliances'), (rows || []).map(function (row) {
      return {
        id: row.id,
        productId: row.productId,
        manufacturerId: row.manufacturerId,
        certificateId: row.certificateId,
        previousCertificateIdsJson: jsonCell(row.previousCertificateIds || []),
        notes: row.notes || '',
        createdAt: row.createdAt || '',
        createdBy: row.createdBy || '',
        updatedAt: row.updatedAt || '',
        updatedBy: row.updatedBy || ''
      };
    }));
  }

  function readCategories(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'StaffTaskCategories');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      return {
        id: id,
        name: text(row.name).trim(),
        status: text(row.status).trim() === 'inactive' ? 'inactive' : 'active',
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
    }).filter(Boolean);
  }

  function writeCategories(spreadsheet, rows) {
    ensureTasks(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'StaffTaskCategories'), (rows || []).map(function (row) {
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt || '',
        updatedAt: row.updatedAt || ''
      };
    }));
  }

  function readTasks(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'StaffTasks');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      return {
        id: id,
        title: text(row.title).trim(),
        description: text(row.description).trim(),
        categoryId: text(row.categoryId).trim(),
        assignedTo: text(row.assignedTo).trim(),
        departmentId: text(row.departmentId).trim(),
        priority: text(row.priority).trim() || 'normal',
        frequency: text(row.frequency).trim(),
        weekDay: num(row.weekDay),
        monthDay: num(row.monthDay),
        annualMonth: num(row.annualMonth),
        annualDay: num(row.annualDay),
        specificDate: text(row.specificDate).trim(),
        time: text(row.time).trim(),
        photoRequirement: text(row.photoRequirement).trim() || 'none',
        active: row.active === '' ? true : flag(row.active),
        referenceType: text(row.referenceType).trim(),
        referenceId: text(row.referenceId).trim(),
        referenceNo: text(row.referenceNo).trim(),
        createdBy: text(row.createdBy).trim(),
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
    }).filter(Boolean);
  }

  function writeTasks(spreadsheet, rows) {
    ensureTasks(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'StaffTasks'), (rows || []).map(function (row) {
      return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        categoryId: row.categoryId,
        assignedTo: row.assignedTo,
        departmentId: row.departmentId || '',
        priority: row.priority || 'normal',
        frequency: row.frequency,
        weekDay: row.weekDay,
        monthDay: row.monthDay,
        annualMonth: row.annualMonth,
        annualDay: row.annualDay,
        specificDate: row.specificDate || '',
        time: row.time || '',
        photoRequirement: row.photoRequirement || 'none',
        active: row.active !== false,
        referenceType: row.referenceType || '',
        referenceId: row.referenceId || '',
        referenceNo: row.referenceNo || '',
        createdBy: row.createdBy || '',
        createdAt: row.createdAt || '',
        updatedAt: row.updatedAt || ''
      };
    }));
  }

  function readOccurrences(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'StaffTaskOccurrences');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      return {
        id: id,
        taskId: text(row.taskId).trim(),
        periodKey: text(row.periodKey).trim(),
        dueAt: text(row.dueAt).trim(),
        status: text(row.status).trim() || 'pending',
        startedAt: text(row.startedAt).trim(),
        completedBy: text(row.completedBy).trim(),
        completedAt: text(row.completedAt).trim(),
        completionNote: text(row.completionNote).trim(),
        completionPhotoUrl: text(row.completionPhotoUrl).trim(),
        completionPhotoName: text(row.completionPhotoName).trim(),
        createdAt: text(row.createdAt).trim()
      };
    }).filter(Boolean);
  }

  function writeOccurrences(spreadsheet, rows) {
    ensureTasks(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'StaffTaskOccurrences'), (rows || []).map(function (row) {
      return {
        id: row.id,
        taskId: row.taskId,
        periodKey: row.periodKey,
        dueAt: row.dueAt,
        status: row.status,
        startedAt: row.startedAt || '',
        completedBy: row.completedBy || '',
        completedAt: row.completedAt || '',
        completionNote: row.completionNote || '',
        completionPhotoUrl: row.completionPhotoUrl || '',
        completionPhotoName: row.completionPhotoName || '',
        createdAt: row.createdAt || ''
      };
    }));
  }

  function readExpenses(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Expenses');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      return {
        id: id,
        date: text(row.date).trim(),
        category: text(row.category).trim(),
        description: text(row.description).trim(),
        amount: num(row.amount),
        paymentMethod: text(row.paymentMethod).trim(),
        notes: text(row.notes).trim()
      };
    }).filter(Boolean);
  }

  function writeExpenses(spreadsheet, rows) {
    ensureExpenses(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Expenses'), (rows || []).map(function (row) {
      return {
        id: row.id,
        date: row.date,
        category: row.category,
        description: row.description,
        amount: row.amount,
        paymentMethod: row.paymentMethod,
        notes: row.notes || ''
      };
    }));
  }

  return {
    ensureHalal: ensureHalal,
    ensureTasks: ensureTasks,
    ensureExpenses: ensureExpenses,
    readManufacturers: readManufacturers,
    writeManufacturers: writeManufacturers,
    readCertificates: readCertificates,
    writeCertificates: writeCertificates,
    readCompliances: readCompliances,
    writeCompliances: writeCompliances,
    readCategories: readCategories,
    writeCategories: writeCategories,
    readTasks: readTasks,
    writeTasks: writeTasks,
    readOccurrences: readOccurrences,
    writeOccurrences: writeOccurrences,
    readExpenses: readExpenses,
    writeExpenses: writeExpenses
  };
}
