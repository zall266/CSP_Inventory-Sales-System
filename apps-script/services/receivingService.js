// Module 10 receiving and stock-order markers.

var RECEIVING_ACTIONS = {
  'receivings.list': true,
  'receivings.get': true,
  'receivings.create': true,
  'receivings.linkPurchase': true
};

var RECEIVING_CONDITIONS = { 'Baik': true, 'Tidak Baik': true, 'Perlu Pemeriksaan': true };
var RECEIVING_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
var RECEIVING_PHOTO_TYPES = { 'image/png': true, 'image/jpeg': true, 'image/webp': true };
var RECEIVING_PHOTO_FOLDER = 'ReceivingPhotos';

function createReceivingService(deps) {
  var sheets = deps.sheetRepository;
  var drive = deps.driveStorage;
  var repository = createReceivingRepository(sheets);
  var purchaseRepo = createPurchaseRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var bomRepo = createBomRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(RECEIVING_ACTIONS[action]);
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

  function requireKey(request) {
    if (!text(request && request.idempotencyKey).trim()) {
      throw appError('VALIDATION_ERROR', 'Idempotency key is required.');
    }
  }

  function clientId(value, prefix) {
    var id = text(value).trim();
    if (!id) return prefix + '_' + createId().replace(/-/g, '').slice(0, 10);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
  }

  // Deterministic ids let a retry find movements a failed attempt already posted.
  // "." cannot appear in a client id, so one receiving's ids never prefix another's.
  function movementIdFor(receivingId, index) {
    return 'mv_' + receivingId + '.' + (index + 1);
  }

  function movementPrefix(receivingId) {
    return 'mv_' + receivingId + '.';
  }

  function findCreateAudit(spreadsheet, receivingId) {
    var found = null;
    sheetRows(spreadsheet, 'AuditLogs').forEach(function (row) {
      if (text(row.action).trim() === 'receivings.create' &&
          text(row.entityType).trim() === 'receiving' &&
          text(row.entityId).trim() === receivingId) found = row;
    });
    return found;
  }

  function auditIdempotencyKey(row) {
    try {
      return text(JSON.parse(text(row.after)).idempotencyKey).trim();
    } catch (error) {
      return '';
    }
  }

  function nextDocNo(values, prefix, pad) {
    var width = pad || 6;
    var max = 0;
    (values || []).forEach(function (value) {
      var raw = text(value);
      if (raw.indexOf(prefix) !== 0) return;
      var n = Number(raw.slice(prefix.length));
      if (Number.isFinite(n) && n > max) max = n;
    });
    return prefix + String(max + 1).padStart(width, '0');
  }

  function productHasBom(boms, productId) {
    var id = text(productId).trim();
    for (var i = 0; i < boms.length; i += 1) {
      if (boms[i].status === 'active' && boms[i].productId === id) return true;
    }
    return false;
  }

  function purchaseConversionQty(product) {
    var qty = Number(product.purchaseConversionQty);
    return Number.isFinite(qty) && qty > 0 ? qty : 1;
  }

  function purchaseQtyToBaseQty(qty, product) {
    var unit = text(product.purchaseUnit || product.unit).trim().toUpperCase();
    var base = text(product.unit).trim().toUpperCase();
    var amount = Number(qty);
    if (!Number.isFinite(amount)) return 0;
    if (unit === base) return round2(amount);
    return round2(amount * purchaseConversionQty(product));
  }

  function requireCompanyWarehouse(spreadsheet, warehouseId) {
    var id = text(warehouseId).trim();
    var found = null;
    masters.readWarehouses(spreadsheet).forEach(function (row) {
      if (row.id === id) found = row;
    });
    if (!found || found.kind !== 'company') throw appError('VALIDATION_ERROR', 'Choose a company warehouse');
    return found;
  }

  function requireProduct(spreadsheet, productId) {
    var found = null;
    products.readProducts(spreadsheet).forEach(function (row) {
      if (row.id === text(productId).trim()) found = row;
    });
    if (!found) throw appError('VALIDATION_ERROR', 'Choose a raw material for every line.');
    if (found.status !== 'active') throw appError('VALIDATION_ERROR', found.name + ' is inactive.');
    return found;
  }

  function buildLines(spreadsheet, items) {
    bomRepo.ensure(spreadsheet);
    var boms = bomRepo.readBoms(spreadsheet);
    var lines = [];
    if (!Array.isArray(items) || !items.length) {
      throw appError('VALIDATION_ERROR', 'Add at least one raw material.');
    }
    items.forEach(function (item) {
      var product = requireProduct(spreadsheet, item.productId);
      if (productHasBom(boms, product.id)) {
        throw appError('VALIDATION_ERROR', product.name + ' is a finished product. Receive raw materials only.');
      }
      var qty = Number(item.qty);
      if (!Number.isFinite(qty) || !(qty > 0)) {
        throw appError('VALIDATION_ERROR', 'Enter a received quantity greater than 0.');
      }
      var expiry = text(item.expiry).trim();
      if (product.trackExpiry && !expiry) {
        throw appError('VALIDATION_ERROR', 'Enter an expiry date for ' + product.name + '.');
      }
      var condition = text(item.condition).trim();
      if (!RECEIVING_CONDITIONS[condition]) {
        throw appError('VALIDATION_ERROR', 'Please select the material condition.');
      }
      var unit = text(product.purchaseUnit || product.unit).trim();
      lines.push({
        productId: product.id,
        qty: round2(qty),
        unit: unit,
        baseQty: purchaseQtyToBaseQty(qty, product),
        batchNo: text(item.batchNo).trim() || undefined,
        expiry: expiry || undefined,
        notes: text(item.notes).trim() || undefined,
        condition: condition
      });
    });
    return lines;
  }

  function parsePhoto(dataUrl, fileName) {
    var value = text(dataUrl).trim();
    if (!value) return null;
    var match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) throw appError('VALIDATION_ERROR', 'Use a JPG, PNG, or WebP image up to 5 MB.');
    var mime = match[1].toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (!RECEIVING_PHOTO_TYPES[mime]) throw appError('VALIDATION_ERROR', 'Use a JPG, PNG, or WebP image up to 5 MB.');
    var b64 = match[2].replace(/\s/g, '');
    var padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    var bytes = Math.floor((b64.length * 3) / 4) - padding;
    if (!(bytes > 0) || bytes > RECEIVING_PHOTO_MAX_BYTES) {
      throw appError('VALIDATION_ERROR', 'Use a JPG, PNG, or WebP image up to 5 MB.');
    }
    return { mime: mime, bytes: Utilities.base64Decode(b64), name: text(fileName).trim() || 'receiving-photo.jpg' };
  }

  function uploadPhoto(parsed) {
    if (!parsed || !drive) return '';
    drive.createChildFolder(RECEIVING_PHOTO_FOLDER);
    var blob = Utilities.newBlob(parsed.bytes, parsed.mime, parsed.name);
    var uploaded = drive.uploadFile(RECEIVING_PHOTO_FOLDER, blob, parsed.name);
    return uploaded.id;
  }

  function qtyOf(balances, productId, warehouseId) {
    var total = 0;
    balances.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) total = Number(row.qty);
    });
    return total;
  }

  function putQty(balances, productId, warehouseId, qty) {
    var found = false;
    var next = balances.map(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) {
        found = true;
        return { productId: productId, warehouseId: warehouseId, qty: round2(qty) };
      }
      return row;
    });
    if (!found) next.push({ productId: productId, warehouseId: warehouseId, qty: round2(qty) });
    return next;
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function snapshot(spreadsheet) {
    inventoryRepo.ensure(spreadsheet);
    var movements = inventoryRepo.readMovements(spreadsheet);
    movements.reverse();
    return {
      receivings: repository.readReceivings(spreadsheet),
      stockOrders: repository.readStockOrders(spreadsheet),
      inventory: products.readBalances(spreadsheet).map(function (row) {
        return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
      }),
      stockMovements: movements
    };
  }

  // Google Sheets offers no multi-sheet transaction. createReceiving writes in
  // this order: StockMovements, InventoryBalances, ReceivingLines,
  // Receivings header, StockOrders link, AuditLogs (last, as the completion marker).
  // Lines are written before the header so a found header always has the full
  // line set; a retry can then require existing.items.length === lines.length.
  // Every step is safe to repeat, so a retry after a partial failure finishes
  // the remaining steps instead of posting stock a second time.
  function createReceiving(spreadsheet, payload, requestId, actor, idempotencyKey) {
    requireCompanyWarehouse(spreadsheet, payload.warehouseId);
    var lines = buildLines(spreadsheet, payload.items);
    var docs = repository.readReceivings(spreadsheet);
    var id = clientId(payload.clientId || payload.id, 'rcv');
    var warehouseId = text(payload.warehouseId).trim();
    var existing = null;
    docs.forEach(function (row) {
      if (row.id === id) existing = row;
    });
    if (existing) {
      var completed = findCreateAudit(spreadsheet, id);
      if (completed) {
        if (idempotencyKey && auditIdempotencyKey(completed) === idempotencyKey) return existing;
        throw appError('CONFLICT', 'Receiving already exists.');
      }
      if (existing.warehouseId !== warehouseId) throw appError('CONFLICT', 'Receiving already exists.');
      if ((existing.items || []).length !== lines.length) {
        throw appError('CONFLICT', 'Receiving already exists.');
      }
      existing.items.forEach(function (stored, index) {
        var line = lines[index];
        if (!line || line.productId !== stored.productId || round2(line.baseQty) !== round2(stored.baseQty)) {
          throw appError('CONFLICT', 'Receiving already exists.');
        }
      });
    }
    var movements = inventoryRepo.readMovements(spreadsheet);
    var posted = {};
    movements.forEach(function (row, index) {
      posted[row.id] = index;
    });
    var firstPosted = posted[movementIdFor(id, 0)] === undefined ? null : movements[posted[movementIdFor(id, 0)]];
    if (!existing && firstPosted && docs.some(function (row) { return row.receivingNo === firstPosted.reference; })) {
      throw appError('CONFLICT', 'Receiving number was reused after a failed attempt. An admin must reconcile it.');
    }
    var receivingNo = existing
      ? existing.receivingNo
      : firstPosted ? firstPosted.reference : nextDocNo(docs.map(function (row) { return row.receivingNo; }), 'RCV-', 6);
    var date = existing
      ? existing.date
      : firstPosted ? firstPosted.date : (text(payload.date).trim() || nowIso());
    var photoFileId = existing ? (existing.photoFileId || '') : '';
    var photoName = existing ? (existing.photoName || '') : '';
    if (!existing && payload.photoUrl) {
      var parsed = parsePhoto(payload.photoUrl, payload.photoName);
      photoFileId = uploadPhoto(parsed);
      photoName = parsed.name;
    }
    var stockOrderId = text(payload.stockOrderId).trim();
    var balances = products.readBalances(spreadsheet);
    var ownPrefix = movementPrefix(id);
    lines.forEach(function (line, index) {
      var movementId = movementIdFor(id, index);
      if (posted[movementId] !== undefined) {
        var prior = movements[posted[movementId]];
        if (prior.type !== 'receiving' || prior.productId !== line.productId || prior.warehouseId !== warehouseId ||
            round2(prior.stockIn) !== round2(line.baseQty)) {
          throw appError('CONFLICT', 'Receiving already exists.');
        }
        var newer = movements.some(function (row, position) {
          return position > posted[movementId] && row.productId === line.productId &&
            row.warehouseId === warehouseId && row.id.indexOf(ownPrefix) !== 0;
        });
        if (!newer) balances = putQty(balances, line.productId, warehouseId, prior.balance);
        return;
      }
      var current = qtyOf(balances, line.productId, warehouseId);
      var balance = round2(current + line.baseQty);
      var noteParts = [];
      if (line.batchNo) noteParts.push('Lot ' + line.batchNo);
      if (line.expiry) noteParts.push('Exp ' + line.expiry);
      inventoryRepo.appendMovement(spreadsheet, {
        id: movementId,
        date: date,
        reference: receivingNo,
        productId: line.productId,
        warehouseId: warehouseId,
        type: 'receiving',
        stockIn: line.baseQty,
        stockOut: 0,
        balance: balance,
        user: actor.name,
        notes: noteParts.join(' · ')
      });
      balances = putQty(balances, line.productId, warehouseId, balance);
    });
    products.writeBalances(spreadsheet, balances);

    var receiving = existing ? Object.assign({}, existing, { items: lines }) : {
      id: id,
      receivingNo: receivingNo,
      date: date,
      warehouseId: warehouseId,
      source: text(payload.source).trim() || 'other',
      supplierId: text(payload.supplierId).trim() || undefined,
      supplierNote: text(payload.supplierNote).trim() || undefined,
      photoFileId: photoFileId || undefined,
      photoName: photoName || undefined,
      notes: text(payload.notes).trim() || undefined,
      items: lines,
      receivedBy: actor.id,
      receivedByName: actor.name,
      status: 'completed',
      stockOrderId: stockOrderId || undefined
    };
    repository.appendMissingLines(spreadsheet, receiving);
    if (!existing) repository.appendReceivingHeader(spreadsheet, receiving);

    if (stockOrderId) {
      var orders = repository.readStockOrders(spreadsheet);
      var linked = null;
      orders.forEach(function (row) {
        if (row.id === stockOrderId && row.status === 'ordered') linked = row;
      });
      if (linked && linked.warehouseId === receiving.warehouseId) {
        var receivedLine = null;
        lines.forEach(function (line) {
          if (line.productId === linked.productId) receivedLine = line;
        });
        if (receivedLine) {
          var updated = Object.assign({}, linked, {
            status: 'received',
            receivedBy: actor.name,
            receivedAt: date,
            receivingId: receiving.id,
            receivingNo: receivingNo,
            receivedQty: receivedLine.baseQty
          });
          repository.updateStockOrder(spreadsheet, updated);
        }
      }
    }

    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'receivings.create',
      entityType: 'receiving',
      entityId: receiving.id,
      reference: receivingNo,
      before: '',
      after: JSON.stringify({ lines: lines.length, stockOrderId: stockOrderId, idempotencyKey: idempotencyKey || '' }),
      requestId: requestId
    });
    return receiving;
  }

  function linkPurchase(spreadsheet, payload, requestId, actor) {
    var receivingId = text(payload.receivingId).trim();
    var purchaseId = text(payload.purchaseId).trim();
    var receiving = null;
    repository.readReceivings(spreadsheet).forEach(function (row) {
      if (row.id === receivingId) receiving = row;
    });
    if (!receiving) throw appError('NOT_FOUND', 'Receiving not found');
    if (receiving.purchaseId && receiving.purchaseId !== purchaseId) {
      throw appError('VALIDATION_ERROR', 'Receiving already linked');
    }
    var docs = purchaseRepo.readPurchases(spreadsheet);
    var purchase = null;
    docs.forEach(function (row) {
      if (row.id === purchaseId) purchase = row;
    });
    if (!purchase) throw appError('NOT_FOUND', 'Purchase not found');
    if (purchase.receivingId && purchase.receivingId !== receivingId) {
      throw appError('VALIDATION_ERROR', 'Purchase already linked');
    }
    if (purchase.status !== 'draft' && purchase.receivingId !== receivingId) {
      throw appError('VALIDATION_ERROR', 'Link a draft purchase');
    }
    var beforeInv = products.readBalances(spreadsheet).map(function (row) {
      return row.productId + ':' + row.warehouseId + ':' + row.qty;
    }).join('|');
    repository.linkReceivingToPurchase(spreadsheet, receivingId, purchase.id, purchase.purchaseNo);
    var updatedPurchase = Object.assign({}, purchase, { receivingId: receiving.id });
    purchaseRepo.writePurchases(spreadsheet, docs.map(function (row) {
      return row.id === purchase.id ? updatedPurchase : row;
    }));
    var afterInv = products.readBalances(spreadsheet).map(function (row) {
      return row.productId + ':' + row.warehouseId + ':' + row.qty;
    }).join('|');
    if (beforeInv !== afterInv) throw appError('CONFLICT', 'Inventory must not change when linking a purchase.');
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'receivings.linkPurchase',
      entityType: 'receiving',
      entityId: receiving.id,
      reference: receiving.receivingNo,
      before: JSON.stringify({ purchaseId: receiving.purchaseId || '' }),
      after: JSON.stringify({ purchaseId: purchase.id, purchaseNo: purchase.purchaseNo }),
      requestId: requestId
    });
    return { receiving: Object.assign({}, receiving, { purchaseId: purchase.id, purchaseNo: purchase.purchaseNo }), purchase: updatedPurchase };
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'receivings.list') {
        requirePermission(spreadsheet, payload.actorUserId, 'receiving.view', 'You cannot view receiving.');
        repository.ensure(spreadsheet);
        return okEnvelope(snapshot(spreadsheet));
      }
      if (action === 'receivings.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'receiving.view', 'You cannot view receiving.');
        var id = text(payload.id).trim();
        var found = null;
        repository.readReceivings(spreadsheet).forEach(function (row) {
          if (row.id === id) found = row;
        });
        if (!found) throw appError('NOT_FOUND', 'Receiving not found');
        var state = snapshot(spreadsheet);
        state.receiving = found;
        return okEnvelope(state);
      }
      if (action === 'receivings.create') {
        requireKey(request);
        var created = createReceiving(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'receiving.create', 'You cannot receive raw materials.'),
          text(request.idempotencyKey).trim()
        );
        var afterCreate = snapshot(spreadsheet);
        afterCreate.receiving = created;
        return okEnvelope(afterCreate);
      }
      if (action === 'receivings.linkPurchase') {
        requireKey(request);
        var linked = linkPurchase(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'receiving.link_purchase', 'You cannot link receiving to a purchase.')
        );
        var afterLink = snapshot(spreadsheet);
        afterLink.receiving = linked.receiving;
        afterLink.purchase = linked.purchase;
        return okEnvelope(afterLink);
      }
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
