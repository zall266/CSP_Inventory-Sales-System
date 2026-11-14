// Module 17: Halal compliance, staff tasks, expenses. Files land in Drive.

var OPS_ACTIONS = {
  'halal.list': true,
  'halal.saveManufacturer': true,
  'halal.saveCompliance': true,
  'tasks.list': true,
  'tasks.createCategory': true,
  'tasks.updateCategory': true,
  'tasks.deactivateCategory': true,
  'tasks.create': true,
  'tasks.update': true,
  'tasks.deactivate': true,
  'tasks.start': true,
  'tasks.attachPhoto': true,
  'tasks.complete': true,
  'expenses.list': true,
  'expenses.create': true
};

var HALAL_FOLDER = 'HalalCertificates';
var TASK_PHOTO_FOLDER = 'TaskPhotos';
var EXPENSE_CATEGORIES = {
  Rent: true, Utilities: true, Salary: true, Transport: true, Packaging: true,
  Marketing: true, Maintenance: true, Office: true, Other: true
};
var EXPENSE_METHODS = { cash: true, bank_transfer: true, duitnow: true, card: true, ewallet: true };

function createOpsService(deps) {
  var sheets = deps.sheetRepository;
  var drive = deps.driveStorage;
  var repository = createOpsRepository(sheets);
  var products = createProductRepository(sheets);
  var salesRepo = createSalesRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(OPS_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function locked(fn) {
    return withScriptLock(function () {
      return fn(sheets.openSpreadsheet());
    });
  }

  function sheetRows(spreadsheet, name) {
    var sheet = sheets.getSheet(spreadsheet, name);
    if (!sheet) return [];
    return sheets.readObjects(sheet);
  }

  function flagCell(value) {
    return value === true || value === 'true' || value === 'TRUE';
  }

  function loadActor(spreadsheet, actorUserId, message) {
    var id = text(actorUserId).trim();
    if (!id) throw appError('FORBIDDEN', message);
    var match = null;
    sheetRows(spreadsheet, 'Users').forEach(function (row) {
      if (text(row.id).trim() === id) match = row;
    });
    if (!match || text(match.status).trim() !== 'active') throw appError('FORBIDDEN', message);
    return {
      id: text(match.id).trim(),
      name: text(match.name).trim() || text(match.id).trim(),
      roleId: text(match.roleId).trim(),
      role: text(match.role).trim(),
      status: 'active',
      departmentId: text(match.departmentId).trim()
    };
  }

  function actorMay(spreadsheet, actor, key) {
    var roles = sheetRows(spreadsheet, 'Roles').map(function (row) {
      return {
        id: text(row.id).trim(),
        protected: flagCell(row.protected),
        legacyRole: text(row.legacyRole).trim()
      };
    });
    var matrix = {};
    sheetRows(spreadsheet, 'RolePermissions').forEach(function (row) {
      var roleId = text(row.roleId).trim();
      var permissionKey = text(row.permissionKey).trim();
      if (!roleId || !permissionKey) return;
      if (!matrix[roleId]) matrix[roleId] = {};
      matrix[roleId][permissionKey] = flagCell(row.allowed);
    });
    return hasPermission({ roles: roles, settings: { roleMatrix: matrix } }, key, actor);
  }

  function requirePermission(spreadsheet, actorUserId, key, message) {
    var actor = loadActor(spreadsheet, actorUserId, message);
    if (!actorMay(spreadsheet, actor, key)) throw appError('FORBIDDEN', message);
    return actor;
  }

  function requireAnyPermission(spreadsheet, actorUserId, keys, message) {
    var actor = loadActor(spreadsheet, actorUserId, message);
    for (var i = 0; i < keys.length; i += 1) {
      if (actorMay(spreadsheet, actor, keys[i])) return actor;
    }
    throw appError('FORBIDDEN', message);
  }

  function requireKey(request) {
    if (!text(request && request.idempotencyKey).trim()) {
      throw appError('VALIDATION_ERROR', 'Idempotency key is required.');
    }
  }

  function clientId(value, prefix) {
    var id = text(value).trim();
    if (!id) return newId(prefix);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
  }

  function newId(prefix) {
    return prefix + '_' + createId().replace(/-/g, '').slice(0, 10);
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function appendDocAudit(spreadsheet, actor, entry) {
    salesRepo.appendDocumentAudit(spreadsheet, {
      id: newId('dal'),
      action: entry.action,
      documentType: entry.documentType,
      documentId: entry.documentId,
      documentNo: entry.documentNo,
      field: entry.field || '',
      oldValue: entry.oldValue || '',
      newValue: entry.newValue || '',
      changedBy: actor.name,
      changedAt: nowIso()
    });
  }

  function findById(rows, id) {
    var found = null;
    var needle = text(id).trim();
    (rows || []).forEach(function (row) {
      if (row.id === needle) found = row;
    });
    return found;
  }

  function uploadBytes(folder, parsed, previousFileId) {
    if (!drive) throw appError('INTERNAL_ERROR', 'The request could not be completed.');
    drive.createChildFolder(folder);
    var blob = Utilities.newBlob(Utilities.base64Decode(parsed.base64), parsed.mime, parsed.name);
    if (previousFileId) {
      try {
        return drive.replaceFile(previousFileId, blob, parsed.name);
      } catch (error) {
        return drive.uploadFile(folder, blob, parsed.name);
      }
    }
    return drive.uploadFile(folder, blob, parsed.name);
  }

  function seedTaskCategories(spreadsheet) {
    var existing = repository.readCategories(spreadsheet);
    if (existing.length) return existing;
    var now = nowIso();
    var seeded = [
      { id: 'tcat-cleaning', name: 'Cleaning' },
      { id: 'tcat-maintenance', name: 'Maintenance' },
      { id: 'tcat-parcel', name: 'Parcel' },
      { id: 'tcat-warehouse', name: 'Warehouse' },
      { id: 'tcat-general', name: 'General' }
    ].map(function (row) {
      return { id: row.id, name: row.name, status: 'active', createdAt: now, updatedAt: now };
    });
    repository.writeCategories(spreadsheet, seeded);
    return seeded;
  }

  function syncOccurrences(spreadsheet, tasks, occurrences) {
    return missingTaskOccurrences(tasks, occurrences, nowIso(), function (prefix) {
      return newId(prefix);
    });
  }

  function halalSnapshot(spreadsheet) {
    salesRepo.ensure(spreadsheet);
    repository.ensureHalal(spreadsheet);
    return {
      manufacturers: repository.readManufacturers(spreadsheet),
      halalCertificates: repository.readCertificates(spreadsheet),
      halalCompliances: repository.readCompliances(spreadsheet),
      documentAuditLogs: salesRepo.readDocumentAudits(spreadsheet)
    };
  }

  function taskSnapshot(spreadsheet) {
    salesRepo.ensure(spreadsheet);
    repository.ensureTasks(spreadsheet);
    var categories = seedTaskCategories(spreadsheet);
    var tasks = repository.readTasks(spreadsheet);
    var occurrences = syncOccurrences(spreadsheet, tasks, repository.readOccurrences(spreadsheet));
    repository.writeOccurrences(spreadsheet, occurrences);
    return {
      staffTaskCategories: categories,
      staffTasks: tasks,
      staffTaskOccurrences: occurrences,
      documentAuditLogs: salesRepo.readDocumentAudits(spreadsheet)
    };
  }

  function expenseSnapshot(spreadsheet) {
    repository.ensureExpenses(spreadsheet);
    return { expenses: repository.readExpenses(spreadsheet) };
  }

  function saveManufacturer(spreadsheet, payload, requestId, actor) {
    var name = text(payload.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Manufacturer name is required');
    var manufacturers = repository.readManufacturers(spreadsheet);
    var id = text(payload.id || payload.clientId).trim();
    var current = id ? findById(manufacturers, id) : null;
    if (findManufacturerByName(manufacturers, name, current ? current.id : '')) {
      throw appError('VALIDATION_ERROR', 'Manufacturer already exists');
    }
    var now = nowIso();
    var manufacturer;
    if (current) {
      manufacturer = {
        id: current.id,
        name: name,
        registrationNo: text(payload.registrationNo).trim() || undefined,
        address: text(payload.address).trim() || undefined,
        contact: text(payload.contact).trim() || undefined,
        notes: text(payload.notes).trim() || undefined,
        active: payload.active !== false,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        updatedAt: now,
        updatedBy: actor.name
      };
      manufacturers = manufacturers.map(function (row) {
        return row.id === manufacturer.id ? manufacturer : row;
      });
      appendDocAudit(spreadsheet, actor, {
        action: 'manufacturer_updated',
        documentType: 'manufacturer',
        documentId: manufacturer.id,
        documentNo: manufacturer.name,
        oldValue: current.name,
        newValue: manufacturer.name
      });
    } else {
      manufacturer = {
        id: clientId(payload.clientId || payload.id, 'mfr'),
        name: name,
        registrationNo: text(payload.registrationNo).trim() || undefined,
        address: text(payload.address).trim() || undefined,
        contact: text(payload.contact).trim() || undefined,
        notes: text(payload.notes).trim() || undefined,
        active: payload.active !== false,
        createdAt: now,
        createdBy: actor.name,
        updatedAt: now,
        updatedBy: actor.name
      };
      if (findById(manufacturers, manufacturer.id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
      manufacturers = [manufacturer].concat(manufacturers);
      appendDocAudit(spreadsheet, actor, {
        action: 'manufacturer_created',
        documentType: 'manufacturer',
        documentId: manufacturer.id,
        documentNo: manufacturer.name,
        newValue: manufacturer.active ? 'active' : 'inactive'
      });
    }
    repository.writeManufacturers(spreadsheet, manufacturers);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'halal.saveManufacturer',
      entityType: 'manufacturer',
      entityId: manufacturer.id,
      reference: manufacturer.name,
      before: current ? current.name : '',
      after: manufacturer.name,
      requestId: requestId
    });
    return manufacturer;
  }

  function saveCompliance(spreadsheet, payload, requestId, actor) {
    var catalog = products.readProducts(spreadsheet);
    var product = findById(catalog, payload.productId);
    if (!product || text(product.status).trim() === 'inactive') {
      throw appError('VALIDATION_ERROR', 'Select a product');
    }
    var manufacturers = repository.readManufacturers(spreadsheet);
    var manufacturer = findById(manufacturers, payload.manufacturerId);
    if (!manufacturer) throw appError('VALIDATION_ERROR', 'Select a manufacturer');
    var compliances = repository.readCompliances(spreadsheet);
    var certificates = repository.readCertificates(spreadsheet);
    var existingCompliance = text(payload.complianceId).trim()
      ? findById(compliances, payload.complianceId)
      : null;
    if (text(payload.complianceId).trim() && !existingCompliance) {
      throw appError('NOT_FOUND', 'Compliance record not found');
    }
    if (!manufacturer.active && manufacturer.id !== (existingCompliance && existingCompliance.manufacturerId)) {
      throw appError('VALIDATION_ERROR', 'Manufacturer is inactive');
    }
    var suppliedCertificateNo = text(payload.certificateNo).trim();
    var certificateNo = suppliedCertificateNo || newId('hcertno');
    var issuingAuthority = text(payload.issuingAuthority).trim() || 'JAKIM';
    var expiryDate = text(payload.expiryDate).trim();
    if (!isHalalDateKey(expiryDate)) throw appError('VALIDATION_ERROR', 'Expiry date is invalid');
    var issueDate = text(payload.issueDate).trim() || undefined;
    if (issueDate && !isHalalDateKey(issueDate)) throw appError('VALIDATION_ERROR', 'Issue date is invalid');
    if (issueDate && expiryDate < issueDate) {
      throw appError('VALIDATION_ERROR', 'Expiry cannot be earlier than the issue date');
    }
    var currentCertificate = existingCompliance ? findById(certificates, existingCompliance.certificateId) : null;
    var parsedDoc = null;
    if (payload.documentDataUrl) {
      parsedDoc = parseHalalDocument(payload.documentDataUrl, payload.documentName, payload.documentMime);
      if (!parsedDoc.ok) throw appError('VALIDATION_ERROR', parsedDoc.error || 'Certificate is required');
    }
    var renewing = Boolean(existingCompliance && parsedDoc);
    var period = { certificateNo: certificateNo, issuingAuthority: issuingAuthority, issueDate: issueDate, expiryDate: expiryDate };
    var matched = null;
    if (!renewing) {
      if (currentCertificate && certificatePeriodMatches(currentCertificate, period)) matched = currentCertificate;
      else matched = findCertificateByPeriod(certificates, period);
    }
    if (!parsedDoc && !(matched && matched.documentFileId) && !(currentCertificate && currentCertificate.documentFileId)) {
      throw appError('VALIDATION_ERROR', 'Certificate is required');
    }
    var now = nowIso();
    var documentFileId = matched && matched.documentFileId ? matched.documentFileId : (!parsedDoc && currentCertificate ? currentCertificate.documentFileId : undefined);
    var documentName = matched && matched.documentName ? matched.documentName : (!parsedDoc && currentCertificate ? currentCertificate.documentName : undefined);
    var documentMime = matched && matched.documentMime ? matched.documentMime : (!parsedDoc && currentCertificate ? currentCertificate.documentMime : undefined);
    if (parsedDoc) {
      var previous = !renewing && (matched && matched.documentFileId ? matched.documentFileId : (currentCertificate && currentCertificate.documentFileId));
      var uploaded = uploadBytes(HALAL_FOLDER, parsedDoc, previous);
      documentFileId = uploaded.id;
      documentName = parsedDoc.name;
      documentMime = parsedDoc.mime;
    }
    var verificationStatus = payload.verificationStatus === 'verified' ? 'verified' : 'pending';
    var verifiedAt = verificationStatus === 'verified'
      ? (matched && matched.verificationStatus === 'verified' ? matched.verifiedAt : now)
      : undefined;
    var verifiedBy = verificationStatus === 'verified'
      ? (matched && matched.verificationStatus === 'verified' ? matched.verifiedBy : actor.name)
      : undefined;
    var certificate;
    if (matched) {
      certificate = {
        id: matched.id,
        certificateNo: certificateNo,
        issuingAuthority: issuingAuthority,
        issueDate: issueDate,
        expiryDate: expiryDate,
        verificationStatus: verificationStatus,
        verifiedAt: verifiedAt,
        verifiedBy: verifiedBy,
        documentFileId: documentFileId,
        documentName: documentName,
        documentMime: documentMime,
        notes: text(payload.notes).trim() || undefined,
        createdAt: matched.createdAt,
        createdBy: matched.createdBy,
        updatedAt: now,
        updatedBy: actor.name
      };
      certificates = certificates.map(function (row) {
        return row.id === certificate.id ? certificate : row;
      });
      appendDocAudit(spreadsheet, actor, {
        action: 'halal_certificate_updated',
        documentType: 'halal_certificate',
        documentId: certificate.id,
        documentNo: certificate.certificateNo,
        field: matched.verificationStatus === certificate.verificationStatus ? '' : 'verificationStatus',
        oldValue: matched.verificationStatus,
        newValue: certificate.verificationStatus
      });
    } else {
      certificate = {
        id: clientId(payload.certificateClientId, 'hcert'),
        certificateNo: certificateNo,
        issuingAuthority: issuingAuthority,
        issueDate: issueDate,
        expiryDate: expiryDate,
        verificationStatus: verificationStatus,
        verifiedAt: verifiedAt,
        verifiedBy: verifiedBy,
        documentFileId: documentFileId,
        documentName: documentName,
        documentMime: documentMime,
        notes: text(payload.notes).trim() || undefined,
        createdAt: now,
        createdBy: actor.name,
        updatedAt: now,
        updatedBy: actor.name
      };
      certificates = [certificate].concat(certificates);
      appendDocAudit(spreadsheet, actor, {
        action: 'halal_certificate_created',
        documentType: 'halal_certificate',
        documentId: certificate.id,
        documentNo: certificate.certificateNo,
        newValue: certificate.verificationStatus
      });
    }
    var duplicate = false;
    compliances.forEach(function (item) {
      if (item.id !== (existingCompliance && existingCompliance.id)
        && item.productId === product.id
        && item.manufacturerId === manufacturer.id
        && item.certificateId === certificate.id) duplicate = true;
    });
    if (duplicate) throw appError('VALIDATION_ERROR', 'Already registered');
    var compliance;
    if (existingCompliance) {
      var previousIds = existingCompliance.certificateId === certificate.id
        ? existingCompliance.previousCertificateIds
        : (existingCompliance.previousCertificateIds || []).concat([existingCompliance.certificateId]);
      compliance = {
        id: existingCompliance.id,
        productId: product.id,
        manufacturerId: manufacturer.id,
        certificateId: certificate.id,
        previousCertificateIds: previousIds,
        notes: text(payload.notes).trim() || undefined,
        createdAt: existingCompliance.createdAt,
        createdBy: existingCompliance.createdBy,
        updatedAt: now,
        updatedBy: actor.name
      };
      compliances = compliances.map(function (row) {
        return row.id === compliance.id ? compliance : row;
      });
      appendDocAudit(spreadsheet, actor, {
        action: 'halal_compliance_updated',
        documentType: 'halal_compliance',
        documentId: compliance.id,
        documentNo: product.name,
        oldValue: existingCompliance.certificateId,
        newValue: certificate.certificateNo
      });
    } else {
      compliance = {
        id: clientId(payload.clientId || payload.complianceId, 'hcomp'),
        productId: product.id,
        manufacturerId: manufacturer.id,
        certificateId: certificate.id,
        previousCertificateIds: [],
        notes: text(payload.notes).trim() || undefined,
        createdAt: now,
        createdBy: actor.name,
        updatedAt: now,
        updatedBy: actor.name
      };
      compliances = [compliance].concat(compliances);
      appendDocAudit(spreadsheet, actor, {
        action: 'halal_compliance_created',
        documentType: 'halal_compliance',
        documentId: compliance.id,
        documentNo: product.name,
        newValue: certificate.certificateNo
      });
    }
    repository.writeCertificates(spreadsheet, certificates);
    repository.writeCompliances(spreadsheet, compliances);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'halal.saveCompliance',
      entityType: 'halal_compliance',
      entityId: compliance.id,
      reference: product.name,
      before: '',
      after: certificate.certificateNo,
      requestId: requestId
    });
    return compliance;
  }

  function canWork(spreadsheet, actor, task) {
    if (actorMay(spreadsheet, actor, 'task.edit')) return true;
    return actorMay(spreadsheet, actor, 'task.complete') && task.assignedTo === actor.id;
  }

  function normalizeTaskFields(spreadsheet, payload, existing, actor) {
    var title = text(payload.title).trim();
    if (!title) throw appError('VALIDATION_ERROR', 'Task title is required');
    var categories = repository.readCategories(spreadsheet);
    if (!categories.length) categories = seedTaskCategories(spreadsheet);
    var category = findById(categories, payload.categoryId);
    if (!category) throw appError('VALIDATION_ERROR', 'Select a task category');
    if (category.status !== 'active' && !(existing && existing.categoryId === category.id)) {
      throw appError('VALIDATION_ERROR', 'This category is inactive');
    }
    var users = sheetRows(spreadsheet, 'Users');
    var assignee = null;
    users.forEach(function (row) {
      if (text(row.id).trim() === text(payload.assignedTo).trim()) assignee = row;
    });
    if (!assignee || text(assignee.status).trim() !== 'active') {
      throw appError('VALIDATION_ERROR', 'Select a staff member');
    }
    var time = parseTaskTime(payload.time);
    if (time === null) throw appError('VALIDATION_ERROR', 'Enter a valid time');
    var frequency = text(payload.frequency).trim();
    if (!TASK_FREQUENCIES[frequency]) throw appError('VALIDATION_ERROR', 'Select a frequency');
    if (frequency === 'specific_date' && !/^\d{4}-\d{2}-\d{2}$/.test(text(payload.specificDate).trim())) {
      throw appError('VALIDATION_ERROR', 'Select a specific date');
    }
    var priority = text(payload.priority).trim() || (existing && existing.priority) || 'normal';
    if (!TASK_PRIORITIES[priority]) priority = 'normal';
    var photoRequirement = text(payload.photoRequirement).trim() || (existing && existing.photoRequirement) || 'none';
    if (!TASK_PHOTO_REQUIREMENTS[photoRequirement]) photoRequirement = 'none';
    return {
      title: title,
      description: text(payload.description).trim(),
      categoryId: category.id,
      assignedTo: text(assignee.id).trim(),
      departmentId: text(payload.departmentId).trim() || text(assignee.departmentId).trim(),
      priority: priority,
      frequency: frequency,
      weekDay: frequency === 'weekly' ? Number(payload.weekDay != null ? payload.weekDay : 1) : (existing ? existing.weekDay : 1),
      monthDay: frequency === 'monthly' ? Number(payload.monthDay != null ? payload.monthDay : 1) : (existing ? existing.monthDay : 1),
      annualMonth: frequency === 'annually' ? Number(payload.annualMonth != null ? payload.annualMonth : 3) : (existing ? existing.annualMonth : 3),
      annualDay: frequency === 'annually' ? Number(payload.annualDay != null ? payload.annualDay : 15) : (existing ? existing.annualDay : 15),
      specificDate: frequency === 'specific_date' ? text(payload.specificDate).trim() : '',
      time: time,
      photoRequirement: photoRequirement,
      referenceType: text(payload.referenceType).trim(),
      referenceId: text(payload.referenceId).trim(),
      referenceNo: text(payload.referenceNo).trim()
    };
  }

  function persistTasks(spreadsheet, tasks, occurrences) {
    repository.writeTasks(spreadsheet, tasks);
    repository.writeOccurrences(spreadsheet, syncOccurrences(spreadsheet, tasks, occurrences));
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'halal.list') {
        requireAnyPermission(spreadsheet, payload.actorUserId, ['halal.view', 'halal.manage'], 'You cannot view Halal Compliance.');
        return okEnvelope(halalSnapshot(spreadsheet));
      }
      if (action === 'halal.saveManufacturer') {
        var manufacturer = saveManufacturer(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'halal.manage', 'You cannot manage Halal Compliance.')
        );
        var afterMfr = halalSnapshot(spreadsheet);
        afterMfr.manufacturer = manufacturer;
        return okEnvelope(afterMfr);
      }
      if (action === 'halal.saveCompliance') {
        var compliance = saveCompliance(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'halal.manage', 'You cannot manage Halal Compliance.')
        );
        var afterComp = halalSnapshot(spreadsheet);
        afterComp.compliance = compliance;
        return okEnvelope(afterComp);
      }
      if (action === 'tasks.list') {
        requireAnyPermission(
          spreadsheet, payload.actorUserId,
          ['task.view', 'task.create', 'task.edit', 'task.complete', 'task.category.manage'],
          'You cannot view tasks.'
        );
        return okEnvelope(taskSnapshot(spreadsheet));
      }
      if (action === 'tasks.createCategory' || action === 'tasks.updateCategory' || action === 'tasks.deactivateCategory') {
        var catActor = requirePermission(spreadsheet, payload.actorUserId, 'task.category.manage', 'You cannot manage task categories.');
        repository.ensureTasks(spreadsheet);
        var categories = seedTaskCategories(spreadsheet);
        var now = nowIso();
        var category;
        if (action === 'tasks.createCategory') {
          var catName = text(payload.name).trim();
          if (!catName) throw appError('VALIDATION_ERROR', 'Category name is required');
          var taken = false;
          categories.forEach(function (row) {
            if (row.name.trim().toLowerCase() === catName.toLowerCase()) taken = true;
          });
          if (taken) throw appError('VALIDATION_ERROR', 'Category already exists');
          category = {
            id: clientId(payload.clientId || payload.id, 'tcat'),
            name: catName,
            status: 'active',
            createdAt: now,
            updatedAt: now
          };
          categories = categories.concat([category]);
          appendDocAudit(spreadsheet, catActor, {
            action: 'task_category_created', documentType: 'staff_task_category',
            documentId: category.id, documentNo: category.name, field: 'name', newValue: category.name
          });
        } else {
          category = findById(categories, payload.id);
          if (!category) throw appError('NOT_FOUND', 'Category was not found.');
          if (action === 'tasks.deactivateCategory') {
            if (category.status !== 'inactive') {
              category = { id: category.id, name: category.name, status: 'inactive', createdAt: category.createdAt, updatedAt: now };
              categories = categories.map(function (row) { return row.id === category.id ? category : row; });
              appendDocAudit(spreadsheet, catActor, {
                action: 'task_category_deactivated', documentType: 'staff_task_category',
                documentId: category.id, documentNo: category.name, field: 'status', oldValue: 'active', newValue: 'inactive'
              });
            }
          } else {
            var nextName = text(payload.name).trim();
            if (!nextName) throw appError('VALIDATION_ERROR', 'Category name is required');
            categories.forEach(function (row) {
              if (row.id !== category.id && row.name.trim().toLowerCase() === nextName.toLowerCase()) {
                throw appError('VALIDATION_ERROR', 'Category already exists');
              }
            });
            var oldName = category.name;
            category = { id: category.id, name: nextName, status: category.status, createdAt: category.createdAt, updatedAt: now };
            categories = categories.map(function (row) { return row.id === category.id ? category : row; });
            appendDocAudit(spreadsheet, catActor, {
              action: 'task_category_edited', documentType: 'staff_task_category',
              documentId: category.id, documentNo: nextName, field: 'name', oldValue: oldName, newValue: nextName
            });
          }
        }
        repository.writeCategories(spreadsheet, categories);
        systemAudit(spreadsheet, {
          userId: catActor.id, action: action, entityType: 'staff_task_category',
          entityId: category.id, reference: category.name, before: '', after: category.status, requestId: requestId
        });
        var afterCat = taskSnapshot(spreadsheet);
        afterCat.category = category;
        return okEnvelope(afterCat);
      }
      if (action === 'tasks.create' || action === 'tasks.update' || action === 'tasks.deactivate') {
        var perm = action === 'tasks.create' ? 'task.create' : 'task.edit';
        var message = action === 'tasks.create' ? 'You cannot create tasks.' : (action === 'tasks.deactivate' ? 'You cannot deactivate tasks.' : 'You cannot edit tasks.');
        var taskActor = requirePermission(spreadsheet, payload.actorUserId, perm, message);
        repository.ensureTasks(spreadsheet);
        seedTaskCategories(spreadsheet);
        var tasks = repository.readTasks(spreadsheet);
        var occurrences = repository.readOccurrences(spreadsheet);
        var task;
        if (action === 'tasks.create') {
          var fields = normalizeTaskFields(spreadsheet, payload, null, taskActor);
          task = Object.assign({
            id: clientId(payload.clientId || payload.id, 'tsk'),
            active: true,
            createdBy: taskActor.id,
            createdAt: nowIso(),
            updatedAt: nowIso()
          }, fields);
          tasks = tasks.concat([task]);
          appendDocAudit(spreadsheet, taskActor, {
            action: 'task_created', documentType: 'staff_task', documentId: task.id, documentNo: task.title, field: 'title', newValue: task.title
          });
        } else {
          task = findById(tasks, payload.id);
          if (!task) throw appError('NOT_FOUND', 'Task was not found.');
          if (action === 'tasks.deactivate') {
            if (task.active) {
              task = Object.assign({}, task, { active: false, updatedAt: nowIso() });
              tasks = tasks.map(function (row) { return row.id === task.id ? task : row; });
              appendDocAudit(spreadsheet, taskActor, {
                action: 'task_deactivated', documentType: 'staff_task', documentId: task.id, documentNo: task.title, field: 'active', oldValue: 'true', newValue: 'false'
              });
            }
          } else {
            var assignedTo = actorMay(spreadsheet, taskActor, 'task.assign') ? payload.assignedTo : task.assignedTo;
            var nextFields = normalizeTaskFields(spreadsheet, Object.assign({}, payload, { assignedTo: assignedTo }), task, taskActor);
            task = Object.assign({}, task, nextFields, { updatedAt: nowIso() });
            tasks = tasks.map(function (row) { return row.id === task.id ? task : row; });
          }
        }
        persistTasks(spreadsheet, tasks, occurrences);
        systemAudit(spreadsheet, {
          userId: taskActor.id, action: action, entityType: 'staff_task',
          entityId: task.id, reference: task.title, before: '', after: task.active ? 'active' : 'inactive', requestId: requestId
        });
        var afterTask = taskSnapshot(spreadsheet);
        afterTask.task = findById(afterTask.staffTasks, task.id);
        return okEnvelope(afterTask);
      }
      if (action === 'tasks.start' || action === 'tasks.attachPhoto' || action === 'tasks.complete') {
        if (action === 'tasks.complete') requireKey(request);
        var workActor = loadActor(spreadsheet, payload.actorUserId, 'You cannot complete this task.');
        var snap = taskSnapshot(spreadsheet);
        var occurrence = findById(snap.staffTaskOccurrences, payload.id || payload.occurrenceId);
        var workTask = occurrence ? findById(snap.staffTasks, occurrence.taskId) : null;
        if (!occurrence || !workTask) throw appError('NOT_FOUND', 'Task was not found.');
        if (!canWork(spreadsheet, workActor, workTask)) {
          throw appError('FORBIDDEN', action === 'tasks.start' ? 'You cannot start this task.' : (action === 'tasks.attachPhoto' ? 'You cannot update this task.' : 'You cannot complete this task.'));
        }
        if (occurrence.status === 'completed' && action !== 'tasks.complete') {
          throw appError('VALIDATION_ERROR', action === 'tasks.start' ? 'Task already completed' : 'Task already completed');
        }
        var nextOcc = Object.assign({}, occurrence);
        if (action === 'tasks.start') {
          if (occurrence.status === 'completed') throw appError('VALIDATION_ERROR', 'Task already completed');
          if (occurrence.status !== 'in_progress') {
            nextOcc.status = 'in_progress';
            nextOcc.startedAt = nowIso();
          }
        } else if (action === 'tasks.attachPhoto') {
          if (occurrence.status === 'completed') throw appError('VALIDATION_ERROR', 'Task already completed');
          if (workTask.photoRequirement === 'none') throw appError('VALIDATION_ERROR', 'This task does not use a photo');
          var parsedPhoto = parseTaskCompletionPhoto(payload.photoUrl, payload.photoName);
          if (!parsedPhoto.ok) throw appError('VALIDATION_ERROR', 'Use a JPG, PNG, or WebP image up to 5 MB.');
          var uploadedPhoto = uploadBytes(TASK_PHOTO_FOLDER, parsedPhoto, occurrence.completionPhotoUrl);
          nextOcc.completionPhotoUrl = uploadedPhoto.id;
          nextOcc.completionPhotoName = parsedPhoto.name;
        } else {
          if (occurrence.status === 'completed') throw appError('VALIDATION_ERROR', 'Task already completed');
          if (payload.photoUrl) {
            var completePhoto = parseTaskCompletionPhoto(payload.photoUrl, payload.photoName);
            if (!completePhoto.ok) throw appError('VALIDATION_ERROR', 'Use a JPG, PNG, or WebP image up to 5 MB.');
            var uploadedComplete = uploadBytes(TASK_PHOTO_FOLDER, completePhoto, occurrence.completionPhotoUrl);
            nextOcc.completionPhotoUrl = uploadedComplete.id;
            nextOcc.completionPhotoName = completePhoto.name;
          }
          if (workTask.photoRequirement === 'required' && !nextOcc.completionPhotoUrl) {
            throw appError('VALIDATION_ERROR', 'Please upload a photo before completing this task.');
          }
          var stamp = nowIso();
          nextOcc.status = 'completed';
          nextOcc.startedAt = nextOcc.startedAt || stamp;
          nextOcc.completedBy = workActor.id;
          nextOcc.completedAt = stamp;
          nextOcc.completionNote = text(payload.note != null ? payload.note : nextOcc.completionNote).trim();
          appendDocAudit(spreadsheet, workActor, {
            action: 'task_completed', documentType: 'staff_task', documentId: workTask.id, documentNo: workTask.title,
            field: 'status', oldValue: occurrence.status, newValue: 'completed'
          });
        }
        var nextOccurrences = snap.staffTaskOccurrences.map(function (row) {
          return row.id === nextOcc.id ? nextOcc : row;
        });
        repository.writeOccurrences(spreadsheet, nextOccurrences);
        systemAudit(spreadsheet, {
          userId: workActor.id, action: action, entityType: 'staff_task_occurrence',
          entityId: nextOcc.id, reference: workTask.title, before: occurrence.status, after: nextOcc.status, requestId: requestId
        });
        var afterWork = taskSnapshot(spreadsheet);
        afterWork.occurrence = findById(afterWork.staffTaskOccurrences, nextOcc.id);
        return okEnvelope(afterWork);
      }
      if (action === 'expenses.list') {
        requireAnyPermission(spreadsheet, payload.actorUserId, ['expenses.manage', 'finance.view'], 'You cannot view expenses.');
        return okEnvelope(expenseSnapshot(spreadsheet));
      }
      if (action === 'expenses.create') {
        var expActor = requirePermission(spreadsheet, payload.actorUserId, 'expenses.manage', 'You cannot manage expenses.');
        var description = text(payload.description).trim();
        var amount = Number(payload.amount);
        if (!description || !(amount > 0)) throw appError('VALIDATION_ERROR', 'Enter description and amount');
        var category = text(payload.category).trim();
        if (!EXPENSE_CATEGORIES[category]) throw appError('VALIDATION_ERROR', 'Enter description and amount');
        var paymentMethod = text(payload.paymentMethod).trim();
        if (!EXPENSE_METHODS[paymentMethod]) throw appError('VALIDATION_ERROR', 'Enter description and amount');
        var expense = {
          id: clientId(payload.clientId || payload.id, 'exp'),
          date: text(payload.date).trim() || nowIso(),
          category: category,
          description: description,
          amount: amount,
          paymentMethod: paymentMethod,
          notes: text(payload.notes).trim()
        };
        var expenses = [expense].concat(repository.readExpenses(spreadsheet));
        repository.writeExpenses(spreadsheet, expenses);
        systemAudit(spreadsheet, {
          userId: expActor.id, action: 'expenses.create', entityType: 'expense',
          entityId: expense.id, reference: expense.description, before: '', after: String(expense.amount), requestId: requestId
        });
        var afterExp = expenseSnapshot(spreadsheet);
        afterExp.expense = expense;
        return okEnvelope(afterExp);
      }
      throw appError('UNKNOWN_ACTION', 'The action is not available.');
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
