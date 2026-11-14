// Module 15 sales import: account → batch → picking/AWB ingest → map → confirm via sales.create.

var SALES_IMPORT_ACTIONS = {
  'salesImport.list': true,
  'salesImport.get': true,
  'salesImport.createAccount': true,
  'salesImport.createBatch': true,
  'salesImport.ingestPicking': true,
  'salesImport.ingestAwb': true,
  'salesImport.acknowledge': true,
  'salesImport.spotCheck': true,
  'salesImport.saveMapping': true,
  'salesImport.updateMapping': true,
  'salesImport.setMappingActive': true,
  'salesImport.confirm': true
};

function createSalesImportService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createSalesImportRepository(sheets);
  var salesRepo = createSalesRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);
  var sales = createSalesService({ sheetRepository: sheets, audit: audit });

  function canHandle(action) {
    return Boolean(SALES_IMPORT_ACTIONS[action]);
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

  function appendDocAudit(spreadsheet, actor, entry) {
    salesRepo.appendDocumentAudit(spreadsheet, {
      id: newId('dal'),
      action: entry.action,
      documentType: entry.documentType || 'sales_import',
      documentId: entry.documentId,
      documentNo: entry.documentNo,
      field: entry.field || '',
      oldValue: entry.oldValue || '',
      newValue: entry.newValue || '',
      changedBy: actor.name,
      changedAt: nowIso()
    });
  }

  function qtyOf(balances, productId, warehouseId) {
    var qty = 0;
    balances.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) qty = Number(row.qty) || 0;
    });
    return round2(qty);
  }

  function catalog(spreadsheet) {
    var list = products.readProducts(spreadsheet);
    var grouped = {};
    products.readComponents(spreadsheet).forEach(function (row) {
      if (!grouped[row.productId]) grouped[row.productId] = [];
      grouped[row.productId].push({ productId: row.componentProductId, qty: row.qty });
    });
    list.forEach(function (product) {
      product.salesComponents = grouped[product.id] || [];
    });
    return list;
  }

  function findProduct(list, productId) {
    var found = null;
    list.forEach(function (row) {
      if (row.id === text(productId).trim()) found = row;
    });
    return found;
  }

  function productIsSellable(product) {
    return !product || product.sellable !== false;
  }

  function stateOf(spreadsheet) {
    repository.ensure(spreadsheet);
    return {
      accounts: repository.readAccounts(spreadsheet),
      batches: repository.readBatches(spreadsheet),
      files: repository.readFiles(spreadsheet),
      orders: repository.readOrders(spreadsheet),
      lines: repository.readLines(spreadsheet),
      mappings: repository.readMappings(spreadsheet),
      shipments: repository.readShipments(spreadsheet),
      sales: salesRepo.readSales(spreadsheet),
      products: catalog(spreadsheet)
    };
  }

  function persist(spreadsheet, state) {
    repository.writeAccounts(spreadsheet, state.accounts);
    repository.writeBatches(spreadsheet, state.batches);
    repository.writeFiles(spreadsheet, state.files);
    repository.writeOrders(spreadsheet, state.orders);
    repository.writeLines(spreadsheet, state.lines);
    repository.writeMappings(spreadsheet, state.mappings);
    repository.writeShipments(spreadsheet, state.shipments);
  }

  function snapshot(spreadsheet) {
    salesRepo.ensure(spreadsheet);
    inventoryRepo.ensure(spreadsheet);
    var state = stateOf(spreadsheet);
    var movements = inventoryRepo.readMovements(spreadsheet);
    movements.reverse();
    return {
      salesImportAccounts: state.accounts,
      salesImportBatches: state.batches,
      salesImportFiles: state.files,
      salesImportOrders: state.orders,
      salesImportLines: state.lines,
      salesImportMappings: state.mappings,
      salesImportShipments: state.shipments,
      sales: state.sales,
      documentAuditLogs: salesRepo.readDocumentAudits(spreadsheet),
      inventory: products.readBalances(spreadsheet).map(function (row) {
        return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
      }),
      stockMovements: movements
    };
  }

  function requirePlatform(value) {
    var platform = text(value).trim();
    if (platform !== 'shopee' && platform !== 'tiktok') {
      throw appError('VALIDATION_ERROR', 'Choose a platform');
    }
    return platform;
  }

  function activeAccount(state, accountId) {
    var found = null;
    state.accounts.forEach(function (row) {
      if (row.id === accountId && row.active !== false) found = row;
    });
    return found;
  }

  function findById(rows, id) {
    var found = null;
    (rows || []).forEach(function (row) {
      if (row.id === id) found = row;
    });
    return found;
  }

  function takenFor(state, platform, accountId, exceptBatchId) {
    var account = findById(state.accounts, accountId);
    if (!account) return new Set();
    return takenOrderIds({
      platform: platform,
      accountId: accountId,
      accountName: account.name,
      exceptBatchId: exceptBatchId,
      orders: state.orders,
      batches: state.batches,
      sales: state.sales
    });
  }

  function rememberExactImportMappings(state, platform, accountId, lines) {
    var mappings = state.mappings.slice();
    var changed = false;
    (lines || []).forEach(function (line) {
      if (!line.mappedProductId) return;
      var identity = mappingIdentity(line);
      if (identity.keyType !== 'sku') return;
      var product = findProduct(state.products, line.mappedProductId);
      if (!product || product.status !== 'active' || text(product.sku).trim() !== identity.key) return;
      var exists = mappings.some(function (row) {
        return row.platform === platform && row.accountId === accountId && row.keyType === 'sku' && row.key === identity.key;
      });
      if (exists) return;
      mappings.unshift({
        id: newId('sim'),
        platform: platform,
        accountId: accountId,
        keyType: 'sku',
        key: identity.key,
        productId: product.id,
        createdAt: nowIso()
      });
      changed = true;
    });
    if (changed) state.mappings = mappings;
  }

  function refreshShipmentLinks(state, platform, accountId, accountName, reviewOrderIds) {
    var known = new Set();
    state.orders.forEach(function (order) {
      var owner = findById(state.batches, order.batchId);
      if (owner && owner.platform === platform && owner.accountId === accountId) known.add(order.externalOrderId);
    });
    var prefix = String(platform).toUpperCase() + ':' + accountName.trim() + ':';
    state.sales.forEach(function (sale) {
      if (sale.status === 'voided' || !sale.reference || sale.reference.indexOf(prefix) !== 0) return;
      known.add(sale.reference.slice(prefix.length));
    });
    var mine = state.shipments.filter(function (shipment) {
      return shipment.platform === platform && shipment.accountId === accountId;
    });
    state.shipments = state.shipments.map(function (shipment) {
      if (shipment.platform !== platform || shipment.accountId !== accountId) return shipment;
      var linkStatus = shipmentLinkStatus({
        externalOrderId: shipment.externalOrderId,
        trackingNumber: shipment.trackingNumber,
        knownOrderIds: known,
        siblingTrackings: mine.filter(function (item) {
          return item.externalOrderId === shipment.externalOrderId;
        }).map(function (item) {
          return item.trackingNumber;
        }),
        reviewOrderIds: reviewOrderIds
      });
      if (linkStatus === shipment.linkStatus) return shipment;
      return Object.assign({}, shipment, { linkStatus: linkStatus, updatedAt: nowIso() });
    });
  }

  function replaceOpenOrders(state, batchId) {
    var batch = findById(state.batches, batchId);
    if (!batch) return;
    var existing = state.orders.filter(function (order) { return order.batchId === batchId; });
    var confirmed = existing.filter(function (order) { return order.status === 'confirmed' && order.saleId; });
    var confirmedKeys = new Set(confirmed.map(function (order) { return order.externalOrderId; }));
    var dropIds = new Set(existing.filter(function (order) {
      return !confirmedKeys.has(order.externalOrderId) || !order.saleId;
    }).map(function (order) { return order.id; }));
    var drafts = materializeOrders({
      files: state.files.filter(function (file) { return file.batchId === batchId; }),
      mappings: state.mappings,
      products: state.products,
      platform: batch.platform,
      accountId: batch.accountId,
      takenOrderIds: takenFor(state, batch.platform, batch.accountId, batchId)
    }).filter(function (draft) { return !confirmedKeys.has(draft.externalOrderId); });
    var orders = drafts.map(function (draft) {
      return {
        id: newId('sio'),
        batchId: batchId,
        externalOrderId: draft.externalOrderId,
        customerMessage: draft.customerMessage,
        status: draft.status,
        fileId: draft.fileId
      };
    });
    var lines = [];
    drafts.forEach(function (draft, index) {
      var order = orders[index];
      (draft.lines || []).forEach(function (line) {
        var next = {
          id: newId('sil'),
          orderId: order.id,
          externalProductName: line.externalProductName,
          quantity: line.quantity,
          quantitySource: 'picking'
        };
        if (line.variationText) next.variationText = line.variationText;
        if (line.parentSku) next.parentSku = line.parentSku;
        if (line.externalSku) next.externalSku = line.externalSku;
        if (line.mappedProductId) next.mappedProductId = line.mappedProductId;
        if (line.unallocated) next.unallocated = true;
        if (line.sharedOrderCount) next.sharedOrderCount = line.sharedOrderCount;
        lines.push(next);
      });
    });
    var keptOrders = state.orders.filter(function (order) { return !dropIds.has(order.id); }).concat(orders);
    var keptLines = state.lines.filter(function (line) { return !dropIds.has(line.orderId); }).concat(lines);
    var account = activeAccount(state, batch.accountId) || findById(state.accounts, batch.accountId);
    var accountOrderIds = new Set(keptOrders.filter(function (order) {
      var owner = findById(state.batches, order.batchId);
      return owner && owner.platform === batch.platform && owner.accountId === batch.accountId;
    }).map(function (order) { return order.id; }));
    var reconciled = reconcileAwbLines({
      orders: keptOrders.filter(function (order) { return accountOrderIds.has(order.id); }),
      lines: keptLines.filter(function (line) { return accountOrderIds.has(line.orderId); }),
      shipments: state.shipments.filter(function (shipment) {
        return shipment.platform === batch.platform && shipment.accountId === batch.accountId;
      })
    });
    var reconciledIds = new Set(reconciled.lines.map(function (line) { return line.id; }));
    state.orders = keptOrders;
    state.lines = keptLines.filter(function (line) { return !reconciledIds.has(line.id); }).concat(reconciled.lines);
    if (account) refreshShipmentLinks(state, batch.platform, batch.accountId, account.name, reconciled.reviewOrderIds);
    rememberExactImportMappings(state, batch.platform, batch.accountId, lines);
    var files = state.files.filter(function (file) { return file.batchId === batchId; });
    var nextOrders = state.orders.filter(function (order) { return order.batchId === batchId; });
    var taken = takenFor(state, batch.platform, batch.accountId, batchId);
    var refreshed = nextOrders.map(function (order) {
      if (order.status === 'confirmed' && order.saleId) return order;
      var status = liveOrderStatus(order, state.lines, taken);
      return status === order.status ? order : Object.assign({}, order, { status: status });
    });
    var byId = {};
    refreshed.forEach(function (order) { byId[order.id] = order; });
    state.orders = state.orders.map(function (order) { return byId[order.id] || order; });
    state.batches = state.batches.map(function (item) {
      return item.id === batchId
        ? Object.assign({}, item, { status: deriveBatchStatus(refreshed, files.length) })
        : item;
    });
  }

  function assessmentFor(spreadsheet, state, batch) {
    var account = findById(state.accounts, batch.accountId);
    if (!account) throw appError('NOT_FOUND', 'Import batch was not found.');
    var settings = settingsRow(spreadsheet);
    var balances = products.readBalances(spreadsheet);
    return assessSalesImport({
      account: account,
      batch: batch,
      files: state.files,
      orders: state.orders,
      lines: state.lines,
      products: state.products,
      takenOrderIds: takenFor(state, batch.platform, batch.accountId, batch.id),
      allowNegativeStock: flagCell(settings.allowNegativeStock),
      availableQty: function (productId) {
        return qtyOf(balances, productId, SALES_IMPORT_WAREHOUSE_ID);
      }
    });
  }

  function requireMainWarehouse(spreadsheet) {
    masters.ensure(spreadsheet);
    var found = null;
    masters.readWarehouses(spreadsheet).forEach(function (row) {
      if (row.id === SALES_IMPORT_WAREHOUSE_ID) found = row;
    });
    if (!found) throw appError('VALIDATION_ERROR', 'Main Warehouse was not found.');
    if (found.kind === 'agent') throw appError('VALIDATION_ERROR', 'Agent stock sales must use the Agent sale flow.');
    return found;
  }

  function createAccount(spreadsheet, payload, requestId, actor) {
    var platform = requirePlatform(payload.platform);
    var name = text(payload.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Account name is required');
    var state = stateOf(spreadsheet);
    var existing = null;
    state.accounts.forEach(function (row) {
      if (row.active !== false && row.platform === platform && row.name.trim().toLowerCase() === name.toLowerCase()) existing = row;
    });
    if (existing) return existing;
    var account = {
      id: clientId(payload.clientId || payload.id, 'sia'),
      platform: platform,
      name: name,
      active: true,
      createdAt: nowIso()
    };
    if (findById(state.accounts, account.id)) throw appError('CONFLICT', 'Account already exists.');
    state.accounts = [account].concat(state.accounts);
    persist(spreadsheet, state);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.createAccount',
      entityType: 'sales_import_account',
      entityId: account.id,
      reference: platform + ':' + name,
      before: '',
      after: name,
      requestId: requestId
    });
    return account;
  }

  function createBatch(spreadsheet, payload, requestId, actor) {
    var platform = requirePlatform(payload.platform);
    var accountId = text(payload.accountId).trim();
    var state = stateOf(spreadsheet);
    var account = activeAccount(state, accountId);
    if (!account || account.platform !== platform) {
      throw appError('VALIDATION_ERROR', 'Choose an account for this platform');
    }
    var batch = {
      id: clientId(payload.clientId || payload.id, 'sib'),
      platform: platform,
      accountId: account.id,
      status: 'draft',
      createdBy: actor.name,
      createdAt: nowIso()
    };
    if (findById(state.batches, batch.id)) throw appError('CONFLICT', 'Import batch already exists.');
    state.batches = [batch].concat(state.batches);
    persist(spreadsheet, state);
    appendDocAudit(spreadsheet, actor, {
      action: 'sales_import_created',
      documentId: batch.id,
      documentNo: platform + ':' + account.name,
      newValue: account.name
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.createBatch',
      entityType: 'sales_import_batch',
      entityId: batch.id,
      reference: platform + ':' + account.name,
      before: '',
      after: batch.status,
      requestId: requestId
    });
    return batch;
  }

  function ingestPicking(spreadsheet, payload, requestId, actor) {
    var batchId = text(payload.batchId).trim();
    var state = stateOf(spreadsheet);
    var batch = findById(state.batches, batchId);
    if (!batch) throw appError('NOT_FOUND', 'Import batch was not found.');
    if (batch.status === 'confirmed') throw appError('VALIDATION_ERROR', 'This batch is already confirmed.');
    var fileHash = text(payload.fileHash).trim();
    if (!fileHash) throw appError('VALIDATION_ERROR', 'The file could not be read.');
    var duplicate = state.files.some(function (file) { return file.batchId === batchId && file.fileHash === fileHash; });
    if (duplicate) throw appError('VALIDATION_ERROR', 'This file is already in the batch.');
    var parsed;
    try {
      parsed = parsePickingList(payload.items || []);
    } catch (error) {
      parsed = {
        layout: 'unknown',
        identityReliable: false,
        lines: [],
        customerMessages: [],
        warnings: [],
        error: 'Could not read this PDF.'
      };
    }
    var file = {
      id: clientId(payload.clientId || payload.id, 'sif'),
      batchId: batchId,
      role: 'picking',
      fileName: text(payload.fileName).trim() || 'picking-list.pdf',
      fileHash: fileHash,
      detectedLayout: parsed.layout,
      parsedAt: parsed.error ? undefined : nowIso(),
      parseError: parsed.error,
      detectedUsername: parsed.detectedUsername,
      identityReliable: parsed.identityReliable,
      warnings: parsed.warnings,
      customerMessages: parsed.customerMessages,
      parsedLines: parsed.error ? [] : parsed.lines
    };
    state.files = state.files.concat([file]);
    replaceOpenOrders(state, batchId);
    persist(spreadsheet, state);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.ingestPicking',
      entityType: 'sales_import_file',
      entityId: file.id,
      reference: file.fileName,
      before: '',
      after: parsed.error || parsed.layout,
      requestId: requestId
    });
    return file;
  }

  function ingestAwb(spreadsheet, payload, requestId, actor) {
    var batchId = text(payload.batchId).trim();
    var state = stateOf(spreadsheet);
    var batch = findById(state.batches, batchId);
    var account = batch ? (activeAccount(state, batch.accountId) || findById(state.accounts, batch.accountId)) : null;
    if (!batch || !account) throw appError('NOT_FOUND', 'Import batch was not found.');
    var fileHash = text(payload.fileHash).trim();
    if (!fileHash) throw appError('VALIDATION_ERROR', 'The file could not be read.');
    var duplicate = state.files.some(function (file) { return file.batchId === batchId && file.fileHash === fileHash; });
    if (duplicate) throw appError('VALIDATION_ERROR', 'This file is already in the batch.');
    var parsed;
    try {
      parsed = parseAwb(payload.items || []);
    } catch (error) {
      parsed = { layout: 'unknown', identityReliable: false, shipments: [], error: 'Could not read this PDF.' };
    }
    var fileId = clientId(payload.clientId || payload.id, 'sif');
    var file = {
      id: fileId,
      batchId: batchId,
      role: 'awb',
      fileName: text(payload.fileName).trim() || 'awb.pdf',
      fileHash: fileHash,
      detectedLayout: parsed.layout,
      parsedAt: parsed.error ? undefined : nowIso(),
      parseError: parsed.error,
      detectedUsername: parsed.detectedUsername,
      identityReliable: parsed.identityReliable,
      warnings: []
    };
    var mismatch = Boolean(
      parsed.identityReliable &&
      parsed.detectedUsername &&
      parsed.detectedUsername.trim().toLowerCase() !== account.name.trim().toLowerCase()
    );
    state.files = state.files.concat([file]);
    if (parsed.error || mismatch) {
      replaceOpenOrders(state, batchId);
      persist(spreadsheet, state);
      return file;
    }
    var next = state.shipments.slice();
    (parsed.shipments || []).forEach(function (shipment) {
      var owned = next.filter(function (item) {
        return item.platform === batch.platform && item.accountId === batch.accountId;
      });
      if (shipment.trackingNumber && owned.some(function (item) { return item.trackingNumber === shipment.trackingNumber; })) return;
      if (!shipment.trackingNumber && owned.some(function (item) {
        return item.externalOrderId === shipment.externalOrderId && !item.trackingNumber;
      })) return;
      var siblings = owned.filter(function (item) { return item.externalOrderId === shipment.externalOrderId; });
      if (siblings.some(function (item) { return item.trackingNumber !== shipment.trackingNumber; })) {
        siblings.forEach(function (sibling) {
          var index = -1;
          next.forEach(function (item, i) { if (item.id === sibling.id) index = i; });
          if (index >= 0) next[index] = Object.assign({}, next[index], { linkStatus: 'review', updatedAt: nowIso() });
        });
      }
      next.unshift({
        id: newId('shp'),
        platform: batch.platform,
        accountId: batch.accountId,
        batchId: batchId,
        externalOrderId: shipment.externalOrderId,
        trackingNumber: shipment.trackingNumber || '',
        courierText: shipment.courierText || '',
        recipientName: shipment.recipientName,
        recipientAddress: shipment.recipientAddress,
        serviceText: shipment.serviceText,
        sourceFileId: fileId,
        linkStatus: 'pending',
        packingLines: shipment.lines || [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
    });
    state.shipments = next;
    replaceOpenOrders(state, batchId);
    persist(spreadsheet, state);
    var linked = state.shipments.filter(function (item) { return item.sourceFileId === fileId; });
    appendDocAudit(spreadsheet, actor, {
      action: 'sales_import_awb_imported',
      documentId: batch.id,
      documentNo: batch.platform + ':' + account.name,
      newValue: file.fileName
    });
    if (linked.some(function (item) { return item.linkStatus === 'matched'; })) {
      appendDocAudit(spreadsheet, actor, {
        action: 'sales_import_shipment_linked',
        documentId: batch.id,
        documentNo: batch.platform + ':' + account.name,
        newValue: String(linked.filter(function (item) { return item.linkStatus === 'matched'; }).length)
      });
    }
    if (linked.some(function (item) { return item.linkStatus === 'review'; })) {
      appendDocAudit(spreadsheet, actor, {
        action: 'sales_import_shipment_review',
        documentId: batch.id,
        documentNo: batch.platform + ':' + account.name,
        newValue: String(linked.filter(function (item) { return item.linkStatus !== 'matched'; }).length)
      });
    }
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.ingestAwb',
      entityType: 'sales_import_file',
      entityId: file.id,
      reference: file.fileName,
      before: '',
      after: String(linked.length),
      requestId: requestId
    });
    return file;
  }

  function acknowledge(spreadsheet, payload, requestId, actor) {
    var batchId = text(payload.batchId || payload.id).trim();
    var state = stateOf(spreadsheet);
    var batch = findById(state.batches, batchId);
    var account = batch ? (activeAccount(state, batch.accountId) || findById(state.accounts, batch.accountId)) : null;
    if (!batch || !account) throw appError('NOT_FOUND', 'Import batch was not found.');
    var issues = assessmentFor(spreadsheet, state, batch);
    if (issues.mismatch) throw appError('VALIDATION_ERROR', 'Acknowledgement cannot override a different username.');
    batch = Object.assign({}, batch, {
      accountAcknowledged: true,
      accountAcknowledgedBy: actor.name,
      accountAcknowledgedAt: nowIso()
    });
    state.batches = state.batches.map(function (item) { return item.id === batchId ? batch : item; });
    persist(spreadsheet, state);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.acknowledge',
      entityType: 'sales_import_batch',
      entityId: batch.id,
      reference: batch.platform + ':' + account.name,
      before: '',
      after: 'acknowledged',
      requestId: requestId
    });
    return batch;
  }

  function spotCheck(spreadsheet, payload, requestId, actor) {
    var batchId = text(payload.batchId || payload.id).trim();
    var sampleKey = text(payload.key).trim();
    var state = stateOf(spreadsheet);
    var batch = findById(state.batches, batchId);
    if (!batch || !sampleKey || batch.status === 'confirmed') {
      throw appError('VALIDATION_ERROR', 'Spot check could not be saved.');
    }
    var current = {};
    (batch.spotCheckedKeys || []).forEach(function (key) { current[key] = true; });
    if (payload.checked === false) delete current[sampleKey];
    else current[sampleKey] = true;
    var keys = Object.keys(current);
    batch = Object.assign({}, batch, { spotCheckedKeys: keys });
    state.batches = state.batches.map(function (item) { return item.id === batchId ? batch : item; });
    persist(spreadsheet, state);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.spotCheck',
      entityType: 'sales_import_batch',
      entityId: batch.id,
      reference: sampleKey,
      before: '',
      after: payload.checked === false ? 'unchecked' : 'checked',
      requestId: requestId
    });
    return batch;
  }

  function saveMapping(spreadsheet, payload, requestId, actor) {
    var batchId = text(payload.batchId).trim();
    var keyType = text(payload.keyType).trim() === 'text' ? 'text' : 'sku';
    var key = text(payload.key).trim();
    var productId = text(payload.productId).trim();
    var state = stateOf(spreadsheet);
    var batch = findById(state.batches, batchId);
    var product = findProduct(state.products, productId);
    if (!batch || !product || product.status !== 'active' || !key) {
      throw appError('VALIDATION_ERROR', 'Choose a CSP product');
    }
    var mappings = state.mappings.slice();
    var existing = null;
    mappings.forEach(function (row) {
      if (row.platform === batch.platform && row.accountId === batch.accountId && row.keyType === keyType && row.key === key) existing = row;
    });
    if (existing) {
      mappings = mappings.map(function (row) {
        return row.id === existing.id ? Object.assign({}, row, { productId: product.id, active: true }) : row;
      });
    } else {
      mappings.unshift({
        id: clientId(payload.clientId || payload.id, 'sim'),
        platform: batch.platform,
        accountId: batch.accountId,
        keyType: keyType,
        key: key,
        productId: product.id,
        createdAt: nowIso()
      });
    }
    var openOrderIds = new Set(state.orders.filter(function (order) {
      if (order.status === 'confirmed') return false;
      var owner = findById(state.batches, order.batchId);
      return owner && owner.platform === batch.platform && owner.accountId === batch.accountId;
    }).map(function (order) { return order.id; }));
    state.mappings = mappings;
    state.lines = state.lines.map(function (line) {
      if (!openOrderIds.has(line.orderId) || line.mappedProductSnapshot) return line;
      var identity = mappingIdentity(line);
      if (identity.keyType !== keyType || identity.key !== key) return line;
      return Object.assign({}, line, { mappedProductId: product.id });
    });
    var touched = {};
    state.orders.forEach(function (order) {
      if (openOrderIds.has(order.id)) touched[order.batchId] = true;
    });
    Object.keys(touched).forEach(function (id) { replaceOpenOrders(state, id); });
    persist(spreadsheet, state);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.saveMapping',
      entityType: 'sales_import_mapping',
      entityId: existing ? existing.id : mappings[0].id,
      reference: key,
      before: '',
      after: product.id,
      requestId: requestId
    });
    return existing ? findById(state.mappings, existing.id) : state.mappings[0];
  }

  function updateMapping(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var productId = text(payload.productId).trim();
    var state = stateOf(spreadsheet);
    var current = findById(state.mappings, id);
    var product = findProduct(state.products, productId);
    if (!current || !product || product.status !== 'active') {
      throw appError('VALIDATION_ERROR', 'Choose a CSP product');
    }
    var duplicate = state.mappings.some(function (row) {
      return row.id !== current.id &&
        row.platform === current.platform &&
        row.accountId === current.accountId &&
        row.keyType === current.keyType &&
        row.key === current.key;
    });
    if (duplicate) throw appError('VALIDATION_ERROR', 'This platform, account, and SKU already has a mapping.');
    state.mappings = state.mappings.map(function (row) {
      return row.id === current.id ? Object.assign({}, row, { productId: product.id }) : row;
    });
    persist(spreadsheet, state);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.updateMapping',
      entityType: 'sales_import_mapping',
      entityId: current.id,
      reference: current.key,
      before: current.productId,
      after: product.id,
      requestId: requestId
    });
    return findById(state.mappings, current.id);
  }

  function setMappingActive(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var state = stateOf(spreadsheet);
    var current = findById(state.mappings, id);
    if (!current) throw appError('NOT_FOUND', 'Mapping not found');
    var active = payload.active !== false;
    if (active) {
      var duplicate = state.mappings.some(function (row) {
        return row.id !== current.id &&
          mappingIsActive(row) &&
          row.platform === current.platform &&
          row.accountId === current.accountId &&
          row.keyType === current.keyType &&
          row.key === current.key;
      });
      if (duplicate) throw appError('VALIDATION_ERROR', 'An active mapping already uses this platform, account, and SKU.');
    }
    state.mappings = state.mappings.map(function (row) {
      return row.id === current.id ? Object.assign({}, row, { active: active }) : row;
    });
    persist(spreadsheet, state);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.setMappingActive',
      entityType: 'sales_import_mapping',
      entityId: current.id,
      reference: current.key,
      before: String(current.active !== false),
      after: String(active),
      requestId: requestId
    });
    return findById(state.mappings, current.id);
  }

  function confirmBatch(spreadsheet, payload, requestId, actor) {
    var batchId = text(payload.batchId || payload.id).trim();
    var state = stateOf(spreadsheet);
    var batch = findById(state.batches, batchId);
    var account = batch ? (activeAccount(state, batch.accountId) || findById(state.accounts, batch.accountId)) : null;
    if (!batch || !account) throw appError('NOT_FOUND', 'Import batch was not found.');
    requireMainWarehouse(spreadsheet);
    var before = assessmentFor(spreadsheet, state, batch);
    if (before.mismatch || before.needsAcknowledgement || before.shortages.length) {
      throw appError('VALIDATION_ERROR', before.blockers[0] || 'Confirm is blocked.');
    }
    var taken = takenFor(state, batch.platform, batch.accountId, batchId);
    var ready = state.orders.filter(function (order) {
      return order.batchId === batchId && liveOrderStatus(order, state.lines, taken) === 'new';
    });
    if (!ready.length) {
      var already = state.orders.filter(function (order) {
        return order.batchId === batchId && order.status === 'confirmed';
      }).length;
      if (already) {
        return { batch: batch, posted: 0, already: already };
      }
      throw appError('VALIDATION_ERROR', 'Nothing to confirm.');
    }
    ready.forEach(function (order) {
      state.lines.forEach(function (line) {
        if (line.orderId !== order.id || line.unallocated) return;
        var product = line.mappedProductId ? findProduct(state.products, line.mappedProductId) : null;
        if (!product || !productIsSellable(product)) {
          throw appError('VALIDATION_ERROR', 'A product in the confirm set is not sellable.');
        }
        var inactive = null;
        (product.salesComponents || []).forEach(function (row) {
          var component = findProduct(state.products, row.productId);
          if (!component || component.status !== 'active') inactive = component ? component.name : 'Component';
        });
        if (inactive) throw appError('VALIDATION_ERROR', inactive + ' is inactive.');
      });
    });
    var settings = settingsRow(spreadsheet);
    var posted = [];
    ready.forEach(function (order) {
      state = stateOf(spreadsheet);
      batch = findById(state.batches, batchId);
      var current = findById(state.orders, order.id);
      if (!current || current.status === 'confirmed') return;
      var reference = saleReference(batch.platform, account.name, current.externalOrderId);
      var linked = null;
      state.sales.forEach(function (sale) {
        if (sale.status !== 'voided' && sale.reference === reference) linked = sale;
      });
      var lines = state.lines.filter(function (line) {
        return line.orderId === current.id && !line.unallocated && line.mappedProductId;
      });
      if (!lines.length) return;
      var sale = linked;
      if (!sale) {
        sale = sales.createImportedSale(spreadsheet, {
          customerId: text(settings.defaultCustomerId).trim() || 'c-walkin',
          warehouseId: SALES_IMPORT_WAREHOUSE_ID,
          items: lines.map(function (line) {
            var product = findProduct(state.products, line.mappedProductId);
            return {
              productId: line.mappedProductId,
              qty: line.quantity,
              price: product ? product.sellingPrice : 0,
              description: externalLabel(line)
            };
          }),
          paidAmount: 0,
          reference: reference,
          notes: [current.customerMessage, 'Sales import ' + batch.platform + ' ' + account.name].filter(Boolean).join(' — ')
        }, requestId, actor);
      }
      var snapshots = {};
      lines.forEach(function (line) {
        var product = findProduct(state.products, line.mappedProductId);
        snapshots[line.id] = {
          productId: product ? product.id : line.mappedProductId,
          productName: product ? product.name : '',
          sku: product ? product.sku : '',
          unit: product ? product.unit : '',
          mappingKey: mappingKeyLabel(mappingIdentity(line))
        };
      });
      state.orders = state.orders.map(function (item) {
        return item.id === current.id ? Object.assign({}, item, { status: 'confirmed', saleId: sale.id }) : item;
      });
      state.lines = state.lines.map(function (line) {
        return snapshots[line.id] ? Object.assign({}, line, { mappedProductSnapshot: snapshots[line.id] }) : line;
      });
      persist(spreadsheet, state);
      if (!linked) posted.push(sale.invoiceNo);
    });
    state = stateOf(spreadsheet);
    var filesNow = state.files.filter(function (file) { return file.batchId === batchId; });
    taken = takenFor(state, batch.platform, batch.accountId, batchId);
    var refreshed = state.orders.filter(function (order) { return order.batchId === batchId; }).map(function (order) {
      if (order.status === 'confirmed' && order.saleId) return order;
      return Object.assign({}, order, { status: liveOrderStatus(order, state.lines, taken) });
    });
    var byId = {};
    refreshed.forEach(function (order) { byId[order.id] = order; });
    state.orders = state.orders.map(function (order) { return byId[order.id] || order; });
    batch = Object.assign({}, findById(state.batches, batchId), { status: deriveBatchStatus(refreshed, filesNow.length) });
    state.batches = state.batches.map(function (item) { return item.id === batchId ? batch : item; });
    persist(spreadsheet, state);
    if (posted.length) {
      appendDocAudit(spreadsheet, actor, {
        action: 'sales_import_confirmed',
        documentId: batch.id,
        documentNo: batch.platform + ':' + account.name,
        newValue: posted.join(', ')
      });
    }
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'salesImport.confirm',
      entityType: 'sales_import_batch',
      entityId: batch.id,
      reference: batch.platform + ':' + account.name,
      before: '',
      after: JSON.stringify({ posted: posted.length, status: batch.status }),
      requestId: requestId
    });
    return { batch: batch, posted: posted.length, invoices: posted };
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'salesImport.list') {
        requireAnyPermission(
          spreadsheet,
          payload.actorUserId,
          ['sales.view', 'sales.create'],
          'You cannot view sales import.'
        );
        return okEnvelope(snapshot(spreadsheet));
      }
      if (action === 'salesImport.get') {
        requireAnyPermission(
          spreadsheet,
          payload.actorUserId,
          ['sales.view', 'sales.create'],
          'You cannot view sales import.'
        );
        var found = findById(repository.readBatches(spreadsheet), text(payload.id).trim());
        if (!found) throw appError('NOT_FOUND', 'Import batch was not found.');
        var got = snapshot(spreadsheet);
        got.batch = found;
        return okEnvelope(got);
      }
      if (action === 'salesImport.createAccount') {
        var account = createAccount(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterAccount = snapshot(spreadsheet);
        afterAccount.account = account;
        return okEnvelope(afterAccount);
      }
      if (action === 'salesImport.createBatch') {
        var created = createBatch(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterBatch = snapshot(spreadsheet);
        afterBatch.batch = created;
        return okEnvelope(afterBatch);
      }
      if (action === 'salesImport.ingestPicking') {
        var picking = ingestPicking(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterPicking = snapshot(spreadsheet);
        afterPicking.file = picking;
        return okEnvelope(afterPicking);
      }
      if (action === 'salesImport.ingestAwb') {
        var awb = ingestAwb(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterAwb = snapshot(spreadsheet);
        afterAwb.file = awb;
        return okEnvelope(afterAwb);
      }
      if (action === 'salesImport.acknowledge') {
        var acknowledged = acknowledge(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterAck = snapshot(spreadsheet);
        afterAck.batch = acknowledged;
        return okEnvelope(afterAck);
      }
      if (action === 'salesImport.spotCheck') {
        var checked = spotCheck(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterSpot = snapshot(spreadsheet);
        afterSpot.batch = checked;
        return okEnvelope(afterSpot);
      }
      if (action === 'salesImport.saveMapping') {
        var mapping = saveMapping(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterMap = snapshot(spreadsheet);
        afterMap.mapping = mapping;
        return okEnvelope(afterMap);
      }
      if (action === 'salesImport.updateMapping') {
        var updated = updateMapping(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterUpdate = snapshot(spreadsheet);
        afterUpdate.mapping = updated;
        return okEnvelope(afterUpdate);
      }
      if (action === 'salesImport.setMappingActive') {
        var toggled = setMappingActive(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterToggle = snapshot(spreadsheet);
        afterToggle.mapping = toggled;
        return okEnvelope(afterToggle);
      }
      if (action === 'salesImport.confirm') {
        requireKey(request);
        var confirmed = confirmBatch(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot import sales.')
        );
        var afterConfirm = snapshot(spreadsheet);
        afterConfirm.batch = confirmed.batch;
        afterConfirm.posted = confirmed.posted;
        afterConfirm.already = confirmed.already;
        afterConfirm.invoices = confirmed.invoices;
        return okEnvelope(afterConfirm);
      }
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
