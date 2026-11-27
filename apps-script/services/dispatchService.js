// Module 16 dispatch: vehicles, draft/confirm/void, inspection groups. No inventory post.

var DISPATCH_ACTIONS = {
  'dispatch.list': true,
  'dispatch.get': true,
  'vehicles.create': true,
  'vehicles.update': true,
  'vehicles.setActive': true,
  'dispatch.create': true,
  'dispatch.update': true,
  'dispatch.confirm': true,
  'dispatch.void': true,
  'dispatch.createInspectionGroup': true,
  'dispatch.release': true
};

function createDispatchService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createDispatchRepository(sheets);
  var importRepo = createSalesImportRepository(sheets);
  var salesRepo = createSalesRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(DISPATCH_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
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
      status: 'active'
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

  function nextDocNo(values, prefix, pad) {
    var width = pad || 4;
    var max = 0;
    (values || []).forEach(function (value) {
      var current = text(value);
      if (current.indexOf(prefix) !== 0) return;
      var match = current.match(/(\d+)\s*$/);
      if (match) max = Math.max(max, Number(match[1]));
    });
    return prefix + String(max + 1).padStart(width, '0');
  }

  function stateOf(spreadsheet) {
    repository.ensure(spreadsheet);
    return {
      vehicles: repository.readVehicles(spreadsheet),
      dispatches: repository.readDispatches(spreadsheet),
      groups: repository.readGroups(spreadsheet),
      shipments: importRepo.readShipments(spreadsheet)
    };
  }

  function persist(spreadsheet, state) {
    repository.writeVehicles(spreadsheet, state.vehicles);
    repository.writeDispatches(spreadsheet, state.dispatches);
    repository.writeGroups(spreadsheet, state.groups);
  }

  function snapshot(spreadsheet) {
    salesRepo.ensure(spreadsheet);
    inventoryRepo.ensure(spreadsheet);
    var state = stateOf(spreadsheet);
    var movements = inventoryRepo.readMovements(spreadsheet);
    movements.reverse();
    return {
      vehicles: state.vehicles,
      dispatches: state.dispatches,
      inspectionGroups: state.groups,
      documentAuditLogs: salesRepo.readDocumentAudits(spreadsheet),
      inventory: products.readBalances(spreadsheet).map(function (row) {
        return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
      }),
      stockMovements: movements
    };
  }

  function requireVehicleFields(payload) {
    var code = text(payload.code).trim();
    var vehicleType = text(payload.vehicleType).trim();
    var plateNumber = text(payload.plateNumber).trim();
    if (!code || !vehicleType || !plateNumber) {
      throw appError('VALIDATION_ERROR', 'Code, vehicle type, and plate number are required.');
    }
    return { code: code, vehicleType: vehicleType, plateNumber: plateNumber };
  }

  function codeTaken(vehicles, code, exceptId) {
    var needle = code.trim().toLowerCase();
    var taken = false;
    vehicles.forEach(function (row) {
      if (row.id !== exceptId && row.code.trim().toLowerCase() === needle) taken = true;
    });
    return taken;
  }

  function createVehicle(spreadsheet, payload, requestId, actor) {
    var fields = requireVehicleFields(payload);
    var state = stateOf(spreadsheet);
    if (codeTaken(state.vehicles, fields.code)) {
      throw appError('VALIDATION_ERROR', 'Vehicle code already exists');
    }
    var now = nowIso();
    var vehicle = {
      id: clientId(payload.clientId || payload.id, 'veh'),
      code: fields.code,
      vehicleType: fields.vehicleType,
      plateNumber: fields.plateNumber,
      active: true,
      createdAt: now,
      updatedAt: now
    };
    if (findById(state.vehicles, vehicle.id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    state.vehicles = [vehicle].concat(state.vehicles);
    persist(spreadsheet, state);
    appendDocAudit(spreadsheet, actor, {
      action: 'vehicle_created',
      documentType: 'vehicle',
      documentId: vehicle.id,
      documentNo: vehicle.code,
      newValue: vehicle.vehicleType + ' ' + vehicle.plateNumber
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'vehicles.create',
      entityType: 'vehicle',
      entityId: vehicle.id,
      reference: vehicle.code,
      before: '',
      after: JSON.stringify({ code: vehicle.code, plateNumber: vehicle.plateNumber }),
      requestId: requestId
    });
    return vehicle;
  }

  function updateVehicle(spreadsheet, payload, requestId, actor) {
    var state = stateOf(spreadsheet);
    var current = findById(state.vehicles, payload.id);
    if (!current) throw appError('NOT_FOUND', 'Vehicle was not found.');
    var fields = requireVehicleFields(payload);
    if (codeTaken(state.vehicles, fields.code, current.id)) {
      throw appError('VALIDATION_ERROR', 'Vehicle code already exists');
    }
    var vehicle = {
      id: current.id,
      code: fields.code,
      vehicleType: fields.vehicleType,
      plateNumber: fields.plateNumber,
      active: current.active !== false,
      createdAt: current.createdAt,
      updatedAt: nowIso()
    };
    state.vehicles = state.vehicles.map(function (row) {
      return row.id === vehicle.id ? vehicle : row;
    });
    persist(spreadsheet, state);
    appendDocAudit(spreadsheet, actor, {
      action: 'vehicle_updated',
      documentType: 'vehicle',
      documentId: vehicle.id,
      documentNo: vehicle.code,
      oldValue: current.vehicleType + ' ' + current.plateNumber,
      newValue: vehicle.vehicleType + ' ' + vehicle.plateNumber
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'vehicles.update',
      entityType: 'vehicle',
      entityId: vehicle.id,
      reference: vehicle.code,
      before: JSON.stringify({ code: current.code, plateNumber: current.plateNumber }),
      after: JSON.stringify({ code: vehicle.code, plateNumber: vehicle.plateNumber }),
      requestId: requestId
    });
    return vehicle;
  }

  function setVehicleActive(spreadsheet, payload, requestId, actor) {
    var state = stateOf(spreadsheet);
    var current = findById(state.vehicles, payload.id);
    if (!current) throw appError('NOT_FOUND', 'Vehicle was not found.');
    var active = payload.active !== false;
    if (current.active === active) return current;
    var vehicle = {
      id: current.id,
      code: current.code,
      vehicleType: current.vehicleType,
      plateNumber: current.plateNumber,
      active: active,
      createdAt: current.createdAt,
      updatedAt: nowIso()
    };
    state.vehicles = state.vehicles.map(function (row) {
      return row.id === vehicle.id ? vehicle : row;
    });
    persist(spreadsheet, state);
    appendDocAudit(spreadsheet, actor, {
      action: 'vehicle_status_changed',
      documentType: 'vehicle',
      documentId: vehicle.id,
      documentNo: vehicle.code,
      oldValue: current.active ? 'active' : 'inactive',
      newValue: active ? 'active' : 'inactive'
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'vehicles.setActive',
      entityType: 'vehicle',
      entityId: vehicle.id,
      reference: vehicle.code,
      before: current.active ? 'active' : 'inactive',
      after: active ? 'active' : 'inactive',
      requestId: requestId
    });
    return vehicle;
  }

  function requireActiveVehicle(state, vehicleId, required) {
    var id = text(vehicleId).trim();
    if (!id) {
      if (required) throw appError('VALIDATION_ERROR', 'Choose an active vehicle');
      return null;
    }
    var vehicle = findById(state.vehicles, id);
    if (!vehicle || vehicle.active === false) throw appError('VALIDATION_ERROR', 'Choose an active vehicle');
    return vehicle;
  }

  function createDispatchRow(spreadsheet, payload, requestId, actor) {
    var dispatchDate = text(payload.dispatchDate).trim();
    if (!dispatchDate) dispatchDate = businessDate(new Date());
    if (!isDispatchDate(dispatchDate)) throw appError('VALIDATION_ERROR', 'Choose a dispatch date');
    var state = stateOf(spreadsheet);
    var vehicle = requireActiveVehicle(state, payload.vehicleId, false);
    var row = {
      id: clientId(payload.clientId || payload.id, 'dsp'),
      dispatchDate: dispatchDate,
      vehicleId: vehicle ? vehicle.id : '',
      vehicleCode: '',
      vehicleType: '',
      plateNumber: '',
      condition: '',
      status: 'draft',
      lines: [],
      createdBy: actor.name,
      createdAt: nowIso()
    };
    if (findById(state.dispatches, row.id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    state.dispatches = [row].concat(state.dispatches);
    persist(spreadsheet, state);
    appendDocAudit(spreadsheet, actor, {
      action: 'dispatch_created',
      documentType: 'dispatch',
      documentId: row.id,
      documentNo: row.dispatchDate,
      newValue: vehicle ? vehicle.code : ''
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'dispatch.create',
      entityType: 'dispatch',
      entityId: row.id,
      reference: row.dispatchDate,
      before: '',
      after: JSON.stringify({ vehicleId: row.vehicleId }),
      requestId: requestId
    });
    return row;
  }

  function updateDispatchRow(spreadsheet, payload, requestId, actor) {
    var state = stateOf(spreadsheet);
    var current = findById(state.dispatches, payload.id);
    if (!current) throw appError('NOT_FOUND', 'Dispatch was not found.');
    if (current.status !== 'draft') throw appError('VALIDATION_ERROR', 'Confirmed dispatch is locked');
    var dispatchDate = payload.dispatchDate === undefined ? current.dispatchDate : text(payload.dispatchDate).trim();
    if (!isDispatchDate(dispatchDate)) throw appError('VALIDATION_ERROR', 'Choose a dispatch date');
    var vehicleId = payload.vehicleId === undefined ? current.vehicleId : text(payload.vehicleId).trim();
    requireActiveVehicle(state, vehicleId, false);
    var lines = current.lines || [];
    if (payload.lines) {
      if (!Array.isArray(payload.lines)) throw appError('VALIDATION_ERROR', 'Dispatch not saved');
      var prepared = payload.lines.map(function (line) {
        return {
          shipmentId: text(line.shipmentId).trim(),
          courierKey: line.courierKey,
          parcelQty: line.parcelQty
        };
      });
      var error = validateDispatchLines({
        lines: prepared,
        shipments: state.shipments,
        dispatches: state.dispatches,
        dispatchId: current.id
      });
      if (error) throw appError('VALIDATION_ERROR', error);
      lines = snapshotDispatchLines(prepared, state.shipments);
    }
    var selected = {};
    lines.forEach(function (line) {
      selected[line.shipmentId] = true;
    });
    var next = {
      id: current.id,
      dispatchDate: dispatchDate,
      vehicleId: vehicleId,
      vehicleCode: current.vehicleCode || '',
      vehicleType: current.vehicleType || '',
      plateNumber: current.plateNumber || '',
      condition: current.condition || '',
      status: 'draft',
      lines: lines,
      createdBy: current.createdBy,
      createdAt: current.createdAt
    };
    if (current.inspectionGroupId) next.inspectionGroupId = current.inspectionGroupId;
    state.dispatches = state.dispatches.map(function (row) {
      if (row.id === next.id) return next;
      if (row.status === 'draft') {
        var kept = (row.lines || []).filter(function (line) {
          return !selected[line.shipmentId];
        });
        if (kept.length === (row.lines || []).length) return row;
        var copy = Object.assign({}, row);
        copy.lines = kept;
        return copy;
      }
      return row;
    });
    persist(spreadsheet, state);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'dispatch.update',
      entityType: 'dispatch',
      entityId: next.id,
      reference: next.dispatchDate,
      before: '',
      after: JSON.stringify({ vehicleId: next.vehicleId, lineCount: next.lines.length }),
      requestId: requestId
    });
    return next;
  }

  function confirmDispatchRow(spreadsheet, payload, requestId, actor) {
    var state = stateOf(spreadsheet);
    var current = findById(state.dispatches, payload.id);
    if (!current) throw appError('NOT_FOUND', 'Dispatch was not found.');
    if (current.status !== 'draft') throw appError('VALIDATION_ERROR', 'Confirmed dispatch is locked');
    if (!isDispatchDate(current.dispatchDate)) throw appError('VALIDATION_ERROR', 'Choose a dispatch date');
    var vehicle = requireActiveVehicle(state, current.vehicleId, true);
    var error = validateDispatchLines({
      lines: current.lines || [],
      shipments: state.shipments,
      dispatches: state.dispatches,
      dispatchId: current.id
    });
    if (error) throw appError('VALIDATION_ERROR', error);
    var confirmed = {
      id: current.id,
      dispatchDate: current.dispatchDate,
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      vehicleType: vehicle.vehicleType,
      plateNumber: vehicle.plateNumber,
      condition: 'BAIK',
      status: 'confirmed',
      lines: snapshotDispatchLines(current.lines || [], state.shipments),
      createdBy: current.createdBy,
      createdAt: current.createdAt,
      confirmedBy: actor.name,
      confirmedAt: nowIso()
    };
    if (current.inspectionGroupId) confirmed.inspectionGroupId = current.inspectionGroupId;
    state.dispatches = state.dispatches.map(function (row) {
      return row.id === confirmed.id ? confirmed : row;
    });
    persist(spreadsheet, state);
    appendDocAudit(spreadsheet, actor, {
      action: 'dispatch_confirmed',
      documentType: 'dispatch',
      documentId: confirmed.id,
      documentNo: confirmed.dispatchDate + ' ' + confirmed.vehicleCode,
      newValue: confirmed.plateNumber
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'dispatch.confirm',
      entityType: 'dispatch',
      entityId: confirmed.id,
      reference: confirmed.vehicleCode,
      before: 'draft',
      after: 'confirmed',
      requestId: requestId
    });
    return confirmed;
  }

  function voidDispatchRow(spreadsheet, payload, requestId, actor) {
    var state = stateOf(spreadsheet);
    var current = findById(state.dispatches, payload.id);
    if (!current) throw appError('NOT_FOUND', 'Dispatch was not found.');
    if (current.status !== 'confirmed') throw appError('VALIDATION_ERROR', 'Only a confirmed dispatch can be voided');
    var voided = Object.assign({}, current, {
      status: 'void',
      voidedBy: actor.name,
      voidedAt: nowIso()
    });
    state.dispatches = state.dispatches.map(function (row) {
      return row.id === voided.id ? voided : row;
    });
    persist(spreadsheet, state);
    appendDocAudit(spreadsheet, actor, {
      action: 'dispatch_voided',
      documentType: 'dispatch',
      documentId: voided.id,
      documentNo: voided.dispatchDate + ' ' + voided.vehicleCode,
      oldValue: 'confirmed',
      newValue: 'void'
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'dispatch.void',
      entityType: 'dispatch',
      entityId: voided.id,
      reference: voided.vehicleCode,
      before: 'confirmed',
      after: 'void',
      requestId: requestId
    });
    return voided;
  }

  function createGroup(spreadsheet, payload, requestId, actor) {
    var ids = payload.dispatchIds;
    if (!Array.isArray(ids)) throw appError('VALIDATION_ERROR', 'Select at least one confirmed dispatch.');
    var state = stateOf(spreadsheet);
    var issue = validateInspectionGroup(state.dispatches, ids);
    if (issue) throw appError('VALIDATION_ERROR', issue);
    var rows = ids.map(function (id) {
      return findById(state.dispatches, id);
    });
    var now = nowIso();
    var group = {
      id: clientId(payload.clientId || payload.id, 'ig'),
      groupNo: nextDocNo(state.groups.map(function (row) { return row.groupNo; }), 'IG-', 4),
      dispatchDate: rows[0].dispatchDate,
      status: 'confirmed',
      dispatchIds: rows.map(function (row) { return row.id; }),
      createdAt: now,
      createdBy: actor.name,
      confirmedAt: now,
      confirmedBy: actor.name
    };
    if (findById(state.groups, group.id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    var linked = {};
    group.dispatchIds.forEach(function (id) {
      linked[id] = true;
    });
    state.groups = [group].concat(state.groups);
    state.dispatches = state.dispatches.map(function (row) {
      if (!linked[row.id]) return row;
      var next = Object.assign({}, row);
      next.inspectionGroupId = group.id;
      return next;
    });
    persist(spreadsheet, state);
    appendDocAudit(spreadsheet, actor, {
      action: 'inspection_group_created',
      documentType: 'inspection_group',
      documentId: group.id,
      documentNo: group.groupNo,
      field: 'dispatchIds',
      newValue: group.dispatchIds.join(',')
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'dispatch.createInspectionGroup',
      entityType: 'inspection_group',
      entityId: group.id,
      reference: group.groupNo,
      before: '',
      after: JSON.stringify({ dispatchIds: group.dispatchIds }),
      requestId: requestId
    });
    return group;
  }

  function releaseGroup(spreadsheet, payload, requestId, actor) {
    var state = stateOf(spreadsheet);
    var current = findById(state.groups, payload.id);
    if (!current) throw appError('NOT_FOUND', 'Inspection group was not found.');
    if (current.status !== 'confirmed') {
      throw appError('VALIDATION_ERROR', 'Only a confirmed inspection group can be released');
    }
    var released = Object.assign({}, current, { status: 'released' });
    state.groups = state.groups.map(function (row) {
      return row.id === released.id ? released : row;
    });
    state.dispatches = state.dispatches.map(function (row) {
      if (row.inspectionGroupId !== released.id) return row;
      var next = Object.assign({}, row);
      delete next.inspectionGroupId;
      return next;
    });
    persist(spreadsheet, state);
    appendDocAudit(spreadsheet, actor, {
      action: 'inspection_group_released',
      documentType: 'inspection_group',
      documentId: released.id,
      documentNo: released.groupNo,
      oldValue: 'confirmed',
      newValue: 'released'
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'dispatch.release',
      entityType: 'inspection_group',
      entityId: released.id,
      reference: released.groupNo,
      before: 'confirmed',
      after: 'released',
      requestId: requestId
    });
    return released;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'dispatch.list') {
        requireAnyPermission(
          spreadsheet,
          payload.actorUserId,
          ['sales.delivery.view', 'sales.delivery.create', 'sales.delivery.edit', 'settings.edit'],
          'You cannot view dispatch.'
        );
        return okEnvelope(snapshot(spreadsheet));
      }
      if (action === 'dispatch.get') {
        requireAnyPermission(
          spreadsheet,
          payload.actorUserId,
          ['sales.delivery.view', 'sales.delivery.create', 'sales.delivery.edit', 'settings.edit'],
          'You cannot view dispatch.'
        );
        var found = findById(repository.readDispatches(spreadsheet), text(payload.id).trim());
        if (!found) throw appError('NOT_FOUND', 'Dispatch was not found.');
        var got = snapshot(spreadsheet);
        got.dispatch = found;
        return okEnvelope(got);
      }
      if (action === 'vehicles.create') {
        var vehicle = createVehicle(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'settings.edit', 'You cannot maintain vehicles.')
        );
        var afterVehicle = snapshot(spreadsheet);
        afterVehicle.vehicle = vehicle;
        return okEnvelope(afterVehicle);
      }
      if (action === 'vehicles.update') {
        var updatedVehicle = updateVehicle(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'settings.edit', 'You cannot maintain vehicles.')
        );
        var afterUpdateVehicle = snapshot(spreadsheet);
        afterUpdateVehicle.vehicle = updatedVehicle;
        return okEnvelope(afterUpdateVehicle);
      }
      if (action === 'vehicles.setActive') {
        var toggled = setVehicleActive(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'settings.edit', 'You cannot maintain vehicles.')
        );
        var afterToggle = snapshot(spreadsheet);
        afterToggle.vehicle = toggled;
        return okEnvelope(afterToggle);
      }
      if (action === 'dispatch.create') {
        var created = createDispatchRow(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.create', 'You cannot create a dispatch.')
        );
        var afterCreate = snapshot(spreadsheet);
        afterCreate.dispatch = created;
        return okEnvelope(afterCreate);
      }
      if (action === 'dispatch.update') {
        var updated = updateDispatchRow(
          spreadsheet,
          payload,
          requestId,
          requireAnyPermission(
            spreadsheet,
            payload.actorUserId,
            ['sales.delivery.create', 'sales.delivery.edit'],
            'You cannot edit a dispatch.'
          )
        );
        var afterUpdate = snapshot(spreadsheet);
        afterUpdate.dispatch = updated;
        return okEnvelope(afterUpdate);
      }
      if (action === 'dispatch.confirm') {
        requireKey(request);
        var confirmed = confirmDispatchRow(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.create', 'You cannot confirm a dispatch.')
        );
        var afterConfirm = snapshot(spreadsheet);
        afterConfirm.dispatch = confirmed;
        return okEnvelope(afterConfirm);
      }
      if (action === 'dispatch.void') {
        requireKey(request);
        var voided = voidDispatchRow(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.edit', 'You cannot void a dispatch.')
        );
        var afterVoid = snapshot(spreadsheet);
        afterVoid.dispatch = voided;
        return okEnvelope(afterVoid);
      }
      if (action === 'dispatch.createInspectionGroup') {
        requireKey(request);
        var group = createGroup(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.edit', 'You cannot group dispatch records.')
        );
        var afterGroup = snapshot(spreadsheet);
        afterGroup.group = group;
        return okEnvelope(afterGroup);
      }
      if (action === 'dispatch.release') {
        requireKey(request);
        var released = releaseGroup(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.edit', 'You cannot release an inspection group.')
        );
        var afterRelease = snapshot(spreadsheet);
        afterRelease.group = released;
        return okEnvelope(afterRelease);
      }
      throw appError('UNKNOWN_ACTION', 'The action is not available.');
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
