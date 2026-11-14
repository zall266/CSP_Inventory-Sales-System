// Module 14 sales returns: draft/update/cancel, confirm posts good/repack/waste.

var SALES_RETURN_ACTIONS = {
  'salesReturns.list': true,
  'salesReturns.get': true,
  'salesReturns.save': true,
  'salesReturns.update': true,
  'salesReturns.confirm': true,
  'salesReturns.cancel': true,
  'returnSources.list': true,
  'returnSources.upsert': true,
  'returnSources.setActive': true,
  'returnReasons.list': true,
  'returnReasons.upsert': true,
  'returnReasons.setActive': true
};

var DISPOSITION_EQUALITY_ERROR = 'Good + Repack + Waste must equal Returned Quantity.';
var DEFAULT_RETURN_SOURCES = [
  ['rs-shopee', 'Shopee'],
  ['rs-tiktok', 'TikTok Shop'],
  ['rs-website', 'Website'],
  ['rs-whatsapp', 'WhatsApp'],
  ['rs-lazada', 'Lazada'],
  ['rs-walkin', 'Walk-in'],
  ['rs-courier', 'Courier'],
  ['rs-agent', 'Agent'],
  ['rs-wholesale', 'Wholesale'],
  ['rs-other', 'Other']
];
var DEFAULT_RETURN_REASONS = [
  ['rr-changed-mind', 'Customer changed mind'],
  ['rr-damaged', 'Damaged'],
  ['rr-wrong-item', 'Wrong item'],
  ['rr-defective', 'Defective'],
  ['rr-parcel-damaged', 'Parcel damaged'],
  ['rr-expired', 'Expired'],
  ['rr-other', 'Other']
];

function createSalesReturnService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createSalesReturnRepository(sheets);
  var salesRepo = createSalesRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var warehouseRepo = createWarehouseRepository(sheets);
  var partyRepo = createPartyRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(SALES_RETURN_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function n(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
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

  function movementIdFor(docId, index) {
    return 'mv_' + docId + '.' + String(index + 1);
  }

  function settingsRow(spreadsheet) {
    var rows = sheetRows(spreadsheet, 'Settings');
    for (var i = 0; i < rows.length; i += 1) {
      if (text(rows[i].id).trim() === 'settings') return rows[i];
    }
    return {};
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function nextDocNo(values, prefix, pad) {
    var width = pad || 6;
    var max = 0;
    (values || []).forEach(function (value) {
      var current = text(value);
      if (current.indexOf(prefix) !== 0) return;
      var match = current.match(/(\d+)\s*$/);
      if (match) max = Math.max(max, Number(match[1]));
    });
    return prefix + String(max + 1).padStart(width, '0');
  }

  function qtyOf(balances, productId, warehouseId) {
    var qty = 0;
    balances.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) qty = Number(row.qty) || 0;
    });
    return round2(qty);
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

  function movementExists(spreadsheet, id) {
    var found = false;
    inventoryRepo.readMovements(spreadsheet).forEach(function (row) {
      if (row.id === id) found = true;
    });
    return found;
  }

  function seedLookups(spreadsheet) {
    repository.ensure(spreadsheet);
    var stamp = nowIso();
    if (!repository.readSources(spreadsheet).length) {
      repository.writeSources(spreadsheet, DEFAULT_RETURN_SOURCES.map(function (row) {
        return { id: row[0], name: row[1], active: true, createdAt: stamp, updatedAt: stamp };
      }));
    }
    if (!repository.readReasons(spreadsheet).length) {
      repository.writeReasons(spreadsheet, DEFAULT_RETURN_REASONS.map(function (row) {
        return { id: row[0], name: row[1], active: true, createdAt: stamp, updatedAt: stamp };
      }));
    }
  }

  function catalog(spreadsheet) {
    return products.readProducts(spreadsheet);
  }

  function findById(list, id) {
    var found = null;
    (list || []).forEach(function (row) {
      if (row.id === id) found = row;
    });
    return found;
  }

  function requireCompanyWarehouse(spreadsheet, warehouseId) {
    masters.ensure(spreadsheet);
    var id = text(warehouseId).trim();
    var found = findById(masters.readWarehouses(spreadsheet), id);
    if (!found) throw appError('VALIDATION_ERROR', 'Select a company warehouse.');
    if (found.kind === 'agent') throw appError('VALIDATION_ERROR', 'Sales Return cannot post into an Agent warehouse.');
    return found;
  }

  function activeBoxNames(spreadsheet, warehouseId) {
    warehouseRepo.ensure(spreadsheet);
    var locIds = {};
    warehouseRepo.readLocations(spreadsheet).forEach(function (location) {
      if (location.type !== 'BALANCE_AREA' || !location.active) return;
      if (warehouseId && location.warehouseId !== warehouseId) return;
      locIds[location.id] = true;
    });
    var names = [];
    var seen = {};
    warehouseRepo.readSlots(spreadsheet).forEach(function (slot) {
      if (!locIds[slot.locationId] || !slot.active) return;
      var name = 'Box ' + String(slot.slotNo);
      if (seen[name]) return;
      seen[name] = true;
      names.push(name);
    });
    return names;
  }

  function remainingReturnableQty(spreadsheet, sale, productId, excludeReturnId) {
    var line = null;
    (sale.items || []).forEach(function (item) {
      if (item.productId === productId) line = item;
    });
    if (!line) return null;
    var confirmedElsewhere = 0;
    repository.readReturns(spreadsheet).forEach(function (row) {
      if (row.id === excludeReturnId || row.status !== 'confirmed') return;
      if ((row.originalSaleId || row.saleId) !== sale.id) return;
      (row.items || []).forEach(function (item) {
        if (item.productId === productId) confirmedElsewhere += n(item.returnedQty || item.qty);
      });
    });
    var already = Math.max(n(line.returnedQty), confirmedElsewhere);
    return Math.max(0, n(line.qty) - already);
  }

  function buildLines(spreadsheet, items, originalSale, excludeReturnId, warehouseId) {
    var catalogRows = catalog(spreadsheet);
    var seen = {};
    var lines = [];
    (items || []).forEach(function (item, index) {
      var product = findById(catalogRows, text(item.productId).trim());
      if (!product) throw appError('VALIDATION_ERROR', 'Choose a product for every line.');
      if (product.status !== 'active') throw appError('VALIDATION_ERROR', product.name + ' is inactive and cannot be returned.');
      if (seen[product.id]) throw appError('VALIDATION_ERROR', 'Each product can appear only once on a return.');
      seen[product.id] = true;
      var returnedQty = n(item.returnedQty);
      var goodQty = n(item.goodQty);
      var repackQty = n(item.repackQty);
      var wasteQty = n(item.wasteQty);
      if (!(returnedQty > 0)) throw appError('VALIDATION_ERROR', 'Returned quantity for ' + product.name + ' must be greater than 0.');
      if (goodQty < 0 || repackQty < 0 || wasteQty < 0) {
        throw appError('VALIDATION_ERROR', 'Good, Repack, and Waste quantities cannot be negative.');
      }
      if (Math.abs(goodQty + repackQty + wasteQty - returnedQty) >= 0.0001 || goodQty + repackQty + wasteQty <= 0) {
        throw appError('VALIDATION_ERROR', DISPOSITION_EQUALITY_ERROR);
      }
      var recovered;
      var box;
      if (repackQty > 0) {
        recovered = n(item.repackRecoveredGrams);
        if (!(recovered > 0)) throw appError('VALIDATION_ERROR', 'Enter actual recoverable grams for ' + product.name + '.');
        box = text(item.repackStorageBoxId).trim();
        if (!box) throw appError('VALIDATION_ERROR', 'Select a Storage Box for ' + product.name + '.');
        if (activeBoxNames(spreadsheet, warehouseId).indexOf(box) < 0) {
          throw appError('VALIDATION_ERROR', 'Select a valid Storage Box for ' + product.name + '.');
        }
      }
      if (originalSale) {
        var remaining = remainingReturnableQty(spreadsheet, originalSale, product.id, excludeReturnId);
        if (remaining != null && returnedQty > remaining) {
          throw appError('VALIDATION_ERROR', 'Returned quantity for ' + product.name + ' exceeds the original sold quantity.');
        }
      }
      var line = {
        id: text(item.id).trim() || 'srl-' + String(index + 1),
        productId: product.id,
        productNameSnapshot: product.name,
        skuSnapshot: product.sku,
        returnedQty: returnedQty,
        unit: text(item.unit).trim() || product.unit || 'PACK',
        goodQty: goodQty,
        repackQty: repackQty,
        wasteQty: wasteQty,
        qty: returnedQty,
        price: 0
      };
      if (repackQty > 0) {
        line.repackRecoveredGrams = recovered;
        line.repackStorageBoxId = box;
      }
      var wasteReason = text(item.wasteReason).trim();
      var notes = text(item.notes).trim();
      if (wasteReason) line.wasteReason = wasteReason;
      if (notes) line.notes = notes;
      lines.push(line);
    });
    if (!lines.length) throw appError('VALIDATION_ERROR', 'Add at least one return item.');
    return lines;
  }

  function validateInput(spreadsheet, payload, existing) {
    var settings = settingsRow(spreadsheet);
    if (text(settings.allowReturns) && !flagCell(settings.allowReturns)) {
      throw appError('VALIDATION_ERROR', 'Enable returns in Sales Settings.');
    }
    seedLookups(spreadsheet);
    var sourceId = text(payload.sourceId).trim();
    var reasonId = text(payload.reasonId).trim();
    if (!sourceId) throw appError('VALIDATION_ERROR', 'Select a Return Source.');
    if (!reasonId) throw appError('VALIDATION_ERROR', 'Select a Return Reason.');
    var source = findById(repository.readSources(spreadsheet), sourceId);
    if (!source) throw appError('VALIDATION_ERROR', 'Select a valid Return Source.');
    if (!source.active) throw appError('VALIDATION_ERROR', 'This Return Source is inactive.');
    var reason = findById(repository.readReasons(spreadsheet), reasonId);
    if (!reason) throw appError('VALIDATION_ERROR', 'Select a valid Return Reason.');
    if (!reason.active) throw appError('VALIDATION_ERROR', 'This Return Reason is inactive.');
    var originalSaleId = text(payload.originalSaleId || payload.saleId).trim() || undefined;
    var documentNo = text(payload.originalDocumentNo).trim() || undefined;
    var sale = null;
    if (originalSaleId) {
      sale = findById(salesRepo.readSales(spreadsheet), originalSaleId);
      if (!sale) throw appError('VALIDATION_ERROR', 'Original invoice / order was not found.');
      if (text(sale.invoiceNo).indexOf('SAL-') === 0) {
        throw appError('VALIDATION_ERROR', 'Agent sales cannot be returned in this version.');
      }
      documentNo = sale.invoiceNo;
    }
    var warehouseId = text(payload.warehouseId).trim() || (sale && sale.warehouseId) || text(settings.defaultWarehouseId).trim();
    var warehouse = requireCompanyWarehouse(spreadsheet, warehouseId);
    var lines = buildLines(spreadsheet, payload.items, sale, existing && existing.id, warehouse.id);
    var customerId = text(payload.customerId).trim() || (sale && sale.customerId) || undefined;
    var customerName;
    if (customerId) {
      var customer = findById(partyRepo.readCustomers(spreadsheet), customerId);
      if (!customer) throw appError('VALIDATION_ERROR', 'Customer was not found.');
      customerName = customer.name;
    }
    var returnDate = text(payload.returnDate).trim() || (existing && existing.returnDate) || nowIso();
    if (!returnDate) throw appError('VALIDATION_ERROR', 'Select a Return Date.');
    return {
      lines: lines,
      warehouse: warehouse,
      source: source,
      reason: reason,
      sale: sale,
      documentNo: documentNo,
      customerId: customerId,
      customerName: customerName,
      returnDate: returnDate
    };
  }

  function appendDocAudit(spreadsheet, actor, entry) {
    var sales = createSalesRepository(sheets);
    sales.appendDocumentAudit(spreadsheet, {
      id: newId('dal'),
      action: entry.action,
      documentType: 'sales_return',
      documentId: entry.documentId,
      documentNo: entry.documentNo,
      field: entry.field || '',
      oldValue: entry.oldValue || '',
      newValue: entry.newValue || '',
      changedBy: actor.name,
      changedAt: nowIso()
    });
  }

  function snapshot(spreadsheet) {
    seedLookups(spreadsheet);
    salesRepo.ensure(spreadsheet);
    inventoryRepo.ensure(spreadsheet);
    warehouseRepo.ensure(spreadsheet);
    var movements = inventoryRepo.readMovements(spreadsheet);
    movements.reverse();
    return {
      salesReturns: repository.readReturns(spreadsheet),
      returnSources: repository.readSources(spreadsheet),
      returnReasons: repository.readReasons(spreadsheet),
      sales: salesRepo.readSales(spreadsheet),
      documentAuditLogs: salesRepo.readDocumentAudits(spreadsheet),
      inventory: products.readBalances(spreadsheet).map(function (row) {
        return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
      }),
      stockMovements: movements,
      productionBalances: warehouseRepo.readProductionBalances(spreadsheet)
    };
  }

  function saveReturn(spreadsheet, payload, requestId, actor, existing) {
    var built = validateInput(spreadsheet, payload, existing);
    var docs = repository.readReturns(spreadsheet);
    var id = existing ? existing.id : clientId(payload.clientId || payload.id, 'sret');
    if (!existing) existing = findById(docs, id);
    if (existing) {
      if (existing.status === 'confirmed') throw appError('VALIDATION_ERROR', existing.returnNo + ' is locked.');
      if (existing.status === 'cancelled') throw appError('VALIDATION_ERROR', existing.returnNo + ' cannot be edited.');
    }
    var returnNo = existing ? existing.returnNo : nextDocNo(docs.map(function (row) { return row.returnNo; }), 'RT-', 6);
    var doc = {
      id: id,
      returnNo: returnNo,
      returnDate: built.returnDate,
      date: built.returnDate,
      sourceId: built.source.id,
      sourceNameSnapshot: built.source.name,
      reasonId: built.reason.id,
      reasonNameSnapshot: built.reason.name,
      reason: built.reason.name,
      warehouseId: built.warehouse.id,
      items: built.lines,
      status: existing ? existing.status : 'draft',
      createdBy: existing ? existing.createdBy : actor.id,
      createdByName: existing ? existing.createdByName : actor.name,
      createdAt: existing ? existing.createdAt : nowIso(),
      total: 0
    };
    if (built.sale) {
      doc.originalSaleId = built.sale.id;
      doc.saleId = built.sale.id;
      doc.originalDocumentNo = built.documentNo;
    }
    if (built.customerId) doc.customerId = built.customerId;
    if (built.customerName) doc.customerNameSnapshot = built.customerName;
    var notes = text(payload.notes).trim();
    var photoUrl = text(payload.photoUrl).trim();
    var photoName = text(payload.photoName).trim();
    if (notes) doc.notes = notes;
    else if (existing && existing.notes) doc.notes = existing.notes;
    if (payload.evidence) doc.evidence = payload.evidence;
    else if (existing && existing.evidence) doc.evidence = existing.evidence;
    if (photoUrl) doc.photoUrl = photoUrl;
    else if (existing && existing.photoUrl) doc.photoUrl = existing.photoUrl;
    if (photoName) doc.photoName = photoName;
    else if (existing && existing.photoName) doc.photoName = existing.photoName;
    if (existing) {
      if (existing.confirmedBy) doc.confirmedBy = existing.confirmedBy;
      if (existing.confirmedAt) doc.confirmedAt = existing.confirmedAt;
      repository.writeReturns(spreadsheet, docs.map(function (row) {
        return row.id === id ? doc : row;
      }));
    } else {
      repository.writeReturns(spreadsheet, [doc].concat(docs));
      appendDocAudit(spreadsheet, actor, {
        action: 'sales_return_created',
        documentId: doc.id,
        documentNo: doc.returnNo,
        field: 'status',
        oldValue: '',
        newValue: 'draft'
      });
    }
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: existing ? 'salesReturns.update' : 'salesReturns.save',
      entityType: 'sales_return',
      entityId: doc.id,
      reference: doc.returnNo,
      before: existing ? JSON.stringify({ status: existing.status }) : '',
      after: JSON.stringify({ status: doc.status }),
      requestId: requestId
    });
    return doc;
  }

  function postConfirm(spreadsheet, doc, actor, requestId) {
    if (doc.status === 'confirmed') throw appError('CONFLICT', doc.returnNo + ' is locked.');
    if (doc.status === 'cancelled') throw appError('VALIDATION_ERROR', doc.returnNo + ' cannot be confirmed.');
    requireCompanyWarehouse(spreadsheet, doc.warehouseId);
    var balances = products.readBalances(spreadsheet);
    var productionBalances = warehouseRepo.readProductionBalances(spreadsheet);
    var index = 0;
    function postMovement(line) {
      var movementId = movementIdFor(doc.id, index);
      index += 1;
      if (movementExists(spreadsheet, movementId)) return;
      var current = qtyOf(balances, line.productId, doc.warehouseId);
      var nextQty = line.skipInventory ? current : round2(current + line.stockIn - line.stockOut);
      inventoryRepo.appendMovement(spreadsheet, {
        id: movementId,
        date: doc.returnDate || doc.date,
        reference: doc.returnNo,
        productId: line.productId,
        warehouseId: doc.warehouseId,
        type: line.type,
        stockIn: line.stockIn,
        stockOut: line.stockOut,
        balance: nextQty,
        user: actor.name,
        notes: line.notes || ''
      });
      if (!line.skipInventory) balances = putQty(balances, line.productId, doc.warehouseId, nextQty);
    }
    var warehouse = findById(masters.readWarehouses(spreadsheet), doc.warehouseId);
    (doc.items || []).forEach(function (line) {
      if (n(line.goodQty) > 0) {
        postMovement({
          productId: line.productId,
          type: 'sales_return_good',
          stockIn: n(line.goodQty),
          stockOut: 0,
          notes: 'Good ' + line.goodQty + ' ' + line.unit
        });
      }
      if (n(line.repackQty) > 0) {
        var grams = n(line.repackRecoveredGrams);
        var box = text(line.repackStorageBoxId).trim() || 'Box 1';
        postMovement({
          productId: line.productId,
          type: 'sales_return_repack',
          stockIn: 0,
          stockOut: 0,
          skipInventory: true,
          notes: 'Repack ' + line.repackQty + ' ' + line.unit + ' → ' + grams + ' G · ' + box
        });
        productionBalances = [{
          id: newId('pb'),
          productId: line.productId,
          quantity: grams,
          unit: 'g',
          location: warehouse ? warehouse.name : '',
          container: box,
          warehouseId: doc.warehouseId,
          productionDate: doc.returnDate || doc.date,
          productionReference: doc.returnNo,
          status: 'available'
        }].concat(productionBalances);
        postMovement({
          productId: line.productId,
          type: 'production_balance_in',
          stockIn: grams,
          stockOut: 0,
          skipInventory: true,
          notes: 'Sales return recover ' + box
        });
      }
      if (n(line.wasteQty) > 0) {
        postMovement({
          productId: line.productId,
          type: 'sales_return_waste',
          stockIn: 0,
          stockOut: n(line.wasteQty),
          skipInventory: true,
          notes: line.wasteReason || ('Waste ' + line.wasteQty + ' ' + line.unit)
        });
      }
    });
    products.writeBalances(spreadsheet, balances);
    warehouseRepo.writeProductionBalances(spreadsheet, productionBalances);
    if (doc.originalSaleId) {
      var sales = salesRepo.readSales(spreadsheet);
      salesRepo.writeSales(spreadsheet, sales.map(function (sale) {
        if (sale.id !== doc.originalSaleId) return sale;
        var nextItems = (sale.items || []).map(function (saleLine) {
          var match = null;
          doc.items.forEach(function (row) {
            if (row.productId === saleLine.productId) match = row;
          });
          if (!match) return saleLine;
          var copy = Object.assign({}, saleLine);
          copy.returnedQty = n(saleLine.returnedQty) + n(match.returnedQty);
          return copy;
        });
        var fullyReturned = nextItems.every(function (line) { return n(line.returnedQty) >= n(line.qty); });
        var updated = Object.assign({}, sale, { items: nextItems });
        if (fullyReturned) updated.status = 'returned';
        return updated;
      }));
    }
    var confirmed = Object.assign({}, doc, {
      status: 'confirmed',
      confirmedBy: actor.id,
      confirmedAt: nowIso()
    });
    repository.writeReturns(spreadsheet, repository.readReturns(spreadsheet).map(function (row) {
      return row.id === doc.id ? confirmed : row;
    }));
    appendDocAudit(spreadsheet, actor, {
      action: 'sales_return_confirmed',
      documentId: doc.id,
      documentNo: doc.returnNo,
      field: 'status',
      oldValue: 'draft',
      newValue: 'confirmed'
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesReturns.confirm',
      entityType: 'sales_return',
      entityId: doc.id,
      reference: doc.returnNo,
      before: JSON.stringify({ status: doc.status }),
      after: JSON.stringify({ status: 'confirmed' }),
      requestId: requestId
    });
    return confirmed;
  }

  function cancelReturn(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var docs = repository.readReturns(spreadsheet);
    var current = findById(docs, id);
    if (!current) throw appError('NOT_FOUND', 'Return not found');
    if (current.status === 'confirmed') throw appError('VALIDATION_ERROR', current.returnNo + ' is locked.');
    if (current.status === 'cancelled') return current;
    var updated = Object.assign({}, current, {
      status: 'cancelled',
      cancelledBy: actor.id,
      cancelledAt: nowIso()
    });
    repository.writeReturns(spreadsheet, docs.map(function (row) {
      return row.id === id ? updated : row;
    }));
    appendDocAudit(spreadsheet, actor, {
      action: 'sales_return_cancelled',
      documentId: current.id,
      documentNo: current.returnNo,
      field: 'status',
      oldValue: current.status,
      newValue: 'cancelled'
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesReturns.cancel',
      entityType: 'sales_return',
      entityId: current.id,
      reference: current.returnNo,
      before: JSON.stringify({ status: current.status }),
      after: JSON.stringify({ status: 'cancelled' }),
      requestId: requestId
    });
    return updated;
  }

  function slugify(name) {
    var slug = text(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug || 'item';
  }

  function upsertLookup(spreadsheet, kind, payload, requestId, actor) {
    var name = text(payload.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', kind === 'source' ? 'Source name is required' : 'Reason name is required');
    var rows = kind === 'source' ? repository.readSources(spreadsheet) : repository.readReasons(spreadsheet);
    var existing = findById(rows, text(payload.id).trim());
    var clash = null;
    rows.forEach(function (row) {
      if (row.id !== (existing && existing.id) && text(row.name).trim().toLowerCase() === name.toLowerCase()) clash = row;
    });
    if (clash) throw appError('VALIDATION_ERROR', (kind === 'source' ? 'Source already exists' : 'Reason already exists'));
    var stamp = nowIso();
    var next;
    if (existing) {
      next = Object.assign({}, existing, {
        name: name,
        active: payload.active === undefined ? existing.active : payload.active !== false,
        updatedAt: stamp
      });
      rows = rows.map(function (row) { return row.id === existing.id ? next : row; });
    } else {
      next = {
        id: clientId(payload.clientId || payload.id, kind === 'source' ? 'rs-' + slugify(name) : 'rr-' + slugify(name)),
        name: name,
        active: payload.active !== false,
        createdAt: stamp,
        updatedAt: stamp
      };
      rows = rows.concat([next]);
    }
    if (kind === 'source') repository.writeSources(spreadsheet, rows);
    else repository.writeReasons(spreadsheet, rows);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: kind === 'source' ? 'returnSources.upsert' : 'returnReasons.upsert',
      entityType: kind === 'source' ? 'return_source' : 'return_reason',
      entityId: next.id,
      reference: next.name,
      before: existing ? existing.name : '',
      after: next.name,
      requestId: requestId
    });
    return next;
  }

  function setLookupActive(spreadsheet, kind, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var rows = kind === 'source' ? repository.readSources(spreadsheet) : repository.readReasons(spreadsheet);
    var existing = findById(rows, id);
    if (!existing) throw appError('NOT_FOUND', kind === 'source' ? 'Return Source not found' : 'Return Reason not found');
    var next = Object.assign({}, existing, {
      active: payload.active !== false,
      updatedAt: nowIso()
    });
    rows = rows.map(function (row) { return row.id === id ? next : row; });
    if (kind === 'source') repository.writeSources(spreadsheet, rows);
    else repository.writeReasons(spreadsheet, rows);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: kind === 'source' ? 'returnSources.setActive' : 'returnReasons.setActive',
      entityType: kind === 'source' ? 'return_source' : 'return_reason',
      entityId: next.id,
      reference: next.name,
      before: String(existing.active),
      after: String(next.active),
      requestId: requestId
    });
    return next;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'salesReturns.list' || action === 'returnSources.list' || action === 'returnReasons.list') {
        requireAnyPermission(
          spreadsheet,
          payload.actorUserId,
          ['sales_return.view', 'sales_return.create', 'sales_return.manage', 'return_source.manage', 'return_reason.manage'],
          'You do not have permission to view sales returns.'
        );
        return okEnvelope(snapshot(spreadsheet));
      }
      if (action === 'salesReturns.get') {
        requireAnyPermission(
          spreadsheet,
          payload.actorUserId,
          ['sales_return.view', 'sales_return.create', 'sales_return.manage'],
          'You cannot view sales returns.'
        );
        var found = findById(repository.readReturns(spreadsheet), text(payload.id).trim());
        if (!found) throw appError('NOT_FOUND', 'Return not found');
        var got = snapshot(spreadsheet);
        got.salesReturn = found;
        return okEnvelope(got);
      }
      if (action === 'salesReturns.save') {
        var saved = saveReturn(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales_return.create', 'You cannot create a sales return.')
        );
        var afterSave = snapshot(spreadsheet);
        afterSave.salesReturn = saved;
        return okEnvelope(afterSave);
      }
      if (action === 'salesReturns.update') {
        var current = findById(repository.readReturns(spreadsheet), text(payload.id).trim());
        if (!current) throw appError('NOT_FOUND', 'Return not found');
        var updated = saveReturn(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales_return.create', 'You cannot update a sales return.'),
          current
        );
        var afterUpdate = snapshot(spreadsheet);
        afterUpdate.salesReturn = updated;
        return okEnvelope(afterUpdate);
      }
      if (action === 'salesReturns.confirm') {
        requireKey(request);
        var actor = requirePermission(spreadsheet, payload.actorUserId, 'sales_return.create', 'You cannot confirm a sales return.');
        var draft = findById(repository.readReturns(spreadsheet), text(payload.id).trim());
        if (!draft && (payload.items || payload.clientId)) {
          draft = saveReturn(spreadsheet, payload, requestId, actor);
        }
        if (!draft) throw appError('NOT_FOUND', 'Return not found');
        if (draft.status !== 'confirmed') {
          var rebuilt = validateInput(spreadsheet, {
            returnDate: payload.returnDate || draft.returnDate,
            sourceId: payload.sourceId || draft.sourceId,
            originalSaleId: payload.originalSaleId || draft.originalSaleId,
            originalDocumentNo: payload.originalDocumentNo || draft.originalDocumentNo,
            customerId: payload.customerId || draft.customerId,
            reasonId: payload.reasonId || draft.reasonId,
            warehouseId: payload.warehouseId || draft.warehouseId,
            notes: payload.notes !== undefined ? payload.notes : draft.notes,
            items: payload.items || draft.items
          }, draft);
          draft = Object.assign({}, draft, {
            items: rebuilt.lines,
            warehouseId: rebuilt.warehouse.id,
            sourceId: rebuilt.source.id,
            sourceNameSnapshot: rebuilt.source.name,
            reasonId: rebuilt.reason.id,
            reasonNameSnapshot: rebuilt.reason.name,
            reason: rebuilt.reason.name,
            originalSaleId: rebuilt.sale ? rebuilt.sale.id : draft.originalSaleId,
            saleId: rebuilt.sale ? rebuilt.sale.id : draft.saleId,
            originalDocumentNo: rebuilt.documentNo || draft.originalDocumentNo,
            customerId: rebuilt.customerId || draft.customerId,
            customerNameSnapshot: rebuilt.customerName || draft.customerNameSnapshot,
            returnDate: rebuilt.returnDate
          });
        }
        var confirmed = postConfirm(spreadsheet, draft, actor, requestId);
        var afterConfirm = snapshot(spreadsheet);
        afterConfirm.salesReturn = confirmed;
        return okEnvelope(afterConfirm);
      }
      if (action === 'salesReturns.cancel') {
        var cancelled = cancelReturn(
          spreadsheet,
          payload,
          requestId,
          requireAnyPermission(spreadsheet, payload.actorUserId, ['sales_return.manage', 'sales_return.create'], 'You cannot cancel a sales return.')
        );
        var afterCancel = snapshot(spreadsheet);
        afterCancel.salesReturn = cancelled;
        return okEnvelope(afterCancel);
      }
      if (action === 'returnSources.upsert') {
        var source = upsertLookup(
          spreadsheet,
          'source',
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'return_source.manage', 'You cannot manage Return Sources.')
        );
        var afterSource = snapshot(spreadsheet);
        afterSource.returnSource = source;
        return okEnvelope(afterSource);
      }
      if (action === 'returnSources.setActive') {
        var sourceStatus = setLookupActive(
          spreadsheet,
          'source',
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'return_source.manage', 'You cannot manage Return Sources.')
        );
        var afterSourceStatus = snapshot(spreadsheet);
        afterSourceStatus.returnSource = sourceStatus;
        return okEnvelope(afterSourceStatus);
      }
      if (action === 'returnReasons.upsert') {
        var reason = upsertLookup(
          spreadsheet,
          'reason',
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'return_reason.manage', 'You cannot manage Return Reasons.')
        );
        var afterReason = snapshot(spreadsheet);
        afterReason.returnReason = reason;
        return okEnvelope(afterReason);
      }
      if (action === 'returnReasons.setActive') {
        var reasonStatus = setLookupActive(
          spreadsheet,
          'reason',
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'return_reason.manage', 'You cannot manage Return Reasons.')
        );
        var afterReasonStatus = snapshot(spreadsheet);
        afterReasonStatus.returnReason = reasonStatus;
        return okEnvelope(afterReasonStatus);
      }
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
