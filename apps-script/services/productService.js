// Module 3. Product behaviour matches db.createProduct, updateProduct,
// setProductStatus, and saveAgentPrices. There is no product permission key
// on the product screens, so any active user may create, edit, and change
// status. Agent price writes still require agent.manage. Owner keeps full access.
// Product image mutation is the exception: it requires products.edit.
// Catalogue image reads require an active POS or image-editor actor.
// applyBomCosts stays with BOMs (later module). This module stores the
// purchase-derived cost the product form already calculates.
// productIsUsed also checks later transaction sheets when they exist.
// The balance written here is the only usage signal this module persists.

var PRODUCT_ACTIONS = {
  'products.list': true,
  'products.get': true,
  'products.bootstrap': true,
  'products.create': true,
  'products.update': true,
  'products.setStatus': true,
  'products.saveAgentPrices': true,
  'products.getImage': true,
  'products.uploadImage': true,
  'products.replaceImage': true,
  'products.removeImage': true
};

var PRODUCT_IMAGE_FOLDER = 'ProductImages';
var PRODUCT_IMAGE_MAX_BYTES = 1 * 1024 * 1024;
var PRODUCT_IMAGE_TYPES = { 'image/png': true, 'image/jpeg': true, 'image/webp': true };
var PRODUCT_IMAGE_GET_KEYS = ['sales.create', 'agent.sale.create', 'products.edit'];
var PRODUCT_IMAGE_MESSAGE = 'Use a JPG, PNG, or WebP image up to 1 MB.';

var PRODUCT_UNIT_ALIASES = {
  g: 'G', gram: 'G', grams: 'G', kg: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG',
  ml: 'ML', millilitre: 'ML', milliliter: 'ML', millilitres: 'ML', milliliters: 'ML',
  l: 'L', litre: 'L', liter: 'L', litres: 'L', liters: 'L',
  pc: 'PCS', pcs: 'PCS', piece: 'PCS', pieces: 'PCS',
  bag: 'BAG', bags: 'BAG', bottle: 'BOTTLE', bottles: 'BOTTLE', box: 'BOX', boxes: 'BOX',
  carton: 'CARTON', cartons: 'CARTON', roll: 'ROLL', rolls: 'ROLL',
  pack: 'PACKS', packs: 'PACKS', tin: 'TIN', tins: 'TIN'
};

function createProductService(deps) {
  var sheets = deps.sheetRepository;
  var drive = deps.driveStorage;
  var repository = createProductRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(PRODUCT_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function locked(fn) {
    return withScriptLock(function () {
      return fn(sheets.openSpreadsheet());
    });
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function clientId(value) {
    var id = text(value).trim();
    if (!id) return createId();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
  }

  function normalizeUnit(unit) {
    var raw = text(unit).trim();
    if (!raw) return '';
    return PRODUCT_UNIT_ALIASES[raw.toLowerCase()] || raw.toUpperCase();
  }

  function unitsEqual(a, b) {
    var left = normalizeUnit(a);
    var right = normalizeUnit(b);
    return Boolean(left) && left === right;
  }

  function money(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return round2(amount);
  }

  function conversionQty(baseUnit, purchaseUnit, value) {
    if (!baseUnit) throw appError('VALIDATION_ERROR', 'Base Unit is required.');
    if (!purchaseUnit) throw appError('VALIDATION_ERROR', 'Purchase Unit is required.');
    if (unitsEqual(baseUnit, purchaseUnit)) return 1;
    var qty = Number(value);
    if (!Number.isFinite(qty) || !(qty > 0)) throw appError('VALIDATION_ERROR', 'Conversion quantity must be greater than 0.');
    return qty;
  }

  function level(value, fallback) {
    var qty = Number(value);
    if (!Number.isFinite(qty) || qty < 0) return fallback;
    return qty;
  }

  function sheetRows(spreadsheet, name) {
    var sheet = sheets.getSheet(spreadsheet, name);
    if (!sheet) return [];
    return sheets.readObjects(sheet);
  }

  function companyWarehouses(spreadsheet) {
    return sheetRows(spreadsheet, 'Warehouses').map(function (row) {
      return { id: text(row.id).trim(), kind: text(row.kind).trim() };
    }).filter(function (row) { return row.id && row.kind === 'company'; });
  }

  function categories(spreadsheet) {
    return sheetRows(spreadsheet, 'Categories').map(function (row) {
      return { id: text(row.id).trim(), name: text(row.name).trim() };
    }).filter(function (row) { return row.id; });
  }

  function requireCategory(spreadsheet, categoryId) {
    var id = text(categoryId).trim();
    if (!categories(spreadsheet).some(function (category) { return category.id === id; })) {
      throw appError('NOT_FOUND', 'Category was not found.');
    }
    return id;
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

  function requireAgentPrice(spreadsheet, actor) {
    if (!actorMay(spreadsheet, actor, 'agent.manage')) {
      throw appError('FORBIDDEN', 'You cannot change Agent Price.');
    }
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

  function skuKey(sku) {
    return text(sku).trim().toLowerCase();
  }

  function skuTaken(products, sku, excludeId) {
    var needle = skuKey(sku);
    if (!needle) return true;
    return products.some(function (product) {
      return product.id !== excludeId && skuKey(product.sku) === needle;
    });
  }

  function nextSku(products) {
    var used = {};
    products.forEach(function (product) { used[skuKey(product.sku)] = true; });
    for (var n = 100001; n <= 999999; n += 1) {
      var sku = String(n).padStart(6, '0');
      if (!used[sku]) return sku;
    }
    return '';
  }

  function resolveSku(inputSku, products) {
    var manual = text(inputSku).trim();
    if (manual) return { sku: manual, generated: false };
    var sku = nextSku(products);
    if (!sku) throw appError('VALIDATION_ERROR', 'Unable to generate a unique SKU');
    return { sku: sku, generated: true };
  }

  function productIsUsed(spreadsheet, productId) {
    if (sheetRows(spreadsheet, 'InventoryBalances').some(function (row) {
      return text(row.productId).trim() === productId && Number(row.qty) !== 0;
    })) return true;
    var later = [
      ['Sales', 'items'],
      ['SaleLines', 'productId'],
      ['SaleLineComponents', 'productId'],
      ['Purchases', 'items'],
      ['Receivings', 'items'],
      ['OpeningBalances', 'items'],
      ['StockMovements', 'productId'],
      ['ProductionOrders', 'productId'],
      ['PackingAssemblies', 'productId'],
      ['AgentSales', 'items'],
      ['Quotations', 'items'],
      ['QuotationLines', 'productId'],
      ['DeliveryOrders', 'items'],
      ['DeliveryOrderLines', 'productId'],
      ['SalesReturnLines', 'productId'],
      ['SalesImportLines', 'mappedProductId'],
      ['Boms', 'productId']
    ];
    for (var i = 0; i < later.length; i += 1) {
      var rows = sheetRows(spreadsheet, later[i][0]);
      if (!rows.length) continue;
      if (rows.some(function (row) { return rowMentionsProduct(row, productId); })) return true;
    }
    return false;
  }

  function rowMentionsProduct(row, productId) {
    var keys = Object.keys(row || {});
    for (var i = 0; i < keys.length; i += 1) {
      var value = row[keys[i]];
      if (text(value).trim() === productId) return true;
      if (typeof value === 'string' && value.indexOf(productId) !== -1 && value.charAt(0) === '[') {
        try {
          if (JSON.stringify(JSON.parse(value)).indexOf(productId) !== -1) return true;
        } catch (error) {
          return false;
        }
      }
    }
    return false;
  }

  function normalizeComponents(productId, rows, products) {
    var pending = Array.isArray(rows) ? rows : [];
    var merged = {};
    var order = [];
    pending.forEach(function (row) {
      var id = text(row && row.productId).trim();
      var qty = Number(row && row.qty);
      if (!id && (qty === 0 || !Number.isFinite(qty))) return;
      if (!id) throw appError('VALIDATION_ERROR', 'Select a component product.');
      if (!Number.isFinite(qty) || !(qty > 0)) throw appError('VALIDATION_ERROR', 'Component quantity must be greater than 0.');
      if (productId && id === productId) throw appError('VALIDATION_ERROR', 'A product cannot include itself as a sales component.');
      var component = null;
      products.forEach(function (product) { if (product.id === id) component = product; });
      if (!component) throw appError('VALIDATION_ERROR', 'Component product was not found.');
      if (component.status !== 'active') throw appError('VALIDATION_ERROR', component.name + ' is inactive.');
      if (!Object.prototype.hasOwnProperty.call(merged, id)) order.push(id);
      merged[id] = round2((merged[id] || 0) + qty);
    });
    return order.map(function (id) { return { productId: id, qty: merged[id] }; });
  }

  function assemble(spreadsheet) {
    repository.ensure(spreadsheet);
    var products = repository.readProducts(spreadsheet);
    var components = repository.readComponents(spreadsheet);
    var balances = repository.readBalances(spreadsheet);
    var grouped = {};
    components.forEach(function (row) {
      if (!grouped[row.productId]) grouped[row.productId] = [];
      grouped[row.productId].push({ productId: row.componentProductId, qty: row.qty });
    });
    products.forEach(function (product) {
      product.salesComponents = grouped[product.id] || [];
    });
    return { products: products, inventoryBalances: balances, salesComponents: components };
  }

  function snapshot(state) {
    return { products: state.products, inventoryBalances: state.inventoryBalances };
  }

  function withZeros(balances, productId, warehouses) {
    var next = balances.slice();
    warehouses.forEach(function (warehouse) {
      var found = next.some(function (row) {
        return row.productId === productId && row.warehouseId === warehouse.id;
      });
      if (!found) next.push({ productId: productId, warehouseId: warehouse.id, qty: 0 });
    });
    return next;
  }

  function componentRows(existing, productId, items) {
    var next = existing.filter(function (row) { return row.productId !== productId; });
    items.forEach(function (item) {
      next.push({
        id: createId(),
        productId: productId,
        componentProductId: item.productId,
        qty: item.qty
      });
    });
    return next;
  }

  function persist(spreadsheet, products, components, balances) {
    repository.writeProducts(spreadsheet, products);
    repository.writeComponents(spreadsheet, components);
    repository.writeBalances(spreadsheet, balances);
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function buildProduct(spreadsheet, input, products, options) {
    var payload = input || {};
    var name = text(payload.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Product name is required');
    var unit = normalizeUnit(payload.unit);
    if (!unit) throw appError('VALIDATION_ERROR', 'Base Unit is required.');
    var purchaseUnit = normalizeUnit(payload.purchaseUnit || unit) || unit;
    var conversion = conversionQty(unit, purchaseUnit, payload.purchaseConversionQty === undefined ? 1 : payload.purchaseConversionQty);
    var selling = money(payload.sellingPrice);
    if (selling === null) throw appError('VALIDATION_ERROR', 'Selling Price cannot be negative.');
    var wholesale = money(payload.wholesalePrice === undefined ? 0 : payload.wholesalePrice);
    if (wholesale === null) throw appError('VALIDATION_ERROR', 'Wholesale price cannot be negative.');
    var enteredCost = payload.purchaseCost !== undefined && payload.purchaseCost !== null && payload.purchaseCost !== ''
      ? payload.purchaseCost
      : (payload.costPrice !== undefined ? payload.costPrice : 0);
    var purchaseCost = money(enteredCost);
    if (purchaseCost === null) throw appError('VALIDATION_ERROR', 'Cost Price cannot be negative.');
    var skuResult = resolveSku(payload.sku, products);
    if (skuTaken(products, skuResult.sku)) throw appError('VALIDATION_ERROR', 'SKU already exists');
    var id = clientId(payload.id);
    if (products.some(function (product) { return product.id === id; })) throw appError('CONFLICT', 'Product already exists.');
    var categoryId = requireCategory(spreadsheet, payload.categoryId);
    var agentPrice;
    if (Object.prototype.hasOwnProperty.call(payload, 'agentPrice') && payload.agentPrice !== undefined) {
      if (!options || !options.skipAgentPermission) requireAgentPrice(spreadsheet, options.actor);
      var parsedAgent = moneyOrEmpty(payload.agentPrice);
      if (parsedAgent === false) throw appError('VALIDATION_ERROR', 'Agent Price cannot be negative.');
      agentPrice = parsedAgent;
    }
    var components = normalizeComponents(id, payload.salesComponents, products);
    var status = text(payload.status).trim() || 'active';
    if (status !== 'active' && status !== 'inactive') throw appError('VALIDATION_ERROR', 'Product status is not valid.');
    var product = {
      id: id,
      name: name,
      sku: skuResult.sku,
      barcode: text(payload.barcode).trim(),
      categoryId: categoryId,
      unit: unit,
      purchaseUnit: purchaseUnit,
      purchaseConversionQty: conversion,
      purchaseCost: purchaseCost,
      costPrice: round2(purchaseCost / conversion),
      costSource: 'manual',
      sellingPrice: selling,
      wholesalePrice: wholesale,
      sellable: payload.sellable !== undefined ? payload.sellable !== false : true,
      reorderLevel: level(payload.reorderLevel === undefined ? 0 : payload.reorderLevel, 0),
      trackBatch: Boolean(payload.trackBatch),
      trackExpiry: Boolean(payload.trackExpiry),
      status: status,
      accent: text(payload.accent).trim() || '#4F46E5',
      salesComponents: components
    };
    // Client-supplied imageFileId is ignored. Images are written only by dedicated image actions.
    if (agentPrice !== undefined) product.agentPrice = agentPrice;
    return { product: product, generated: skuResult.generated };
  }

  function moneyOrEmpty(value) {
    if (value === undefined || value === null || value === '') return undefined;
    var amount = money(value);
    if (amount === null) return false;
    return amount;
  }

  function zeroWarehouses(spreadsheet) {
    var warehouses = companyWarehouses(spreadsheet);
    if (!warehouses.length) throw appError('NOT_FOUND', 'Warehouse was not found.');
    return warehouses;
  }

  function bootstrap(spreadsheet, payload, requestId) {
    var current = assemble(spreadsheet);
    if (current.products.length) throw appError('CONFLICT', 'Products are already initialized.');
    if (!payload || !Array.isArray(payload.products) || !payload.products.length) {
      throw appError('VALIDATION_ERROR', 'Product bootstrap is incomplete.');
    }
    var actorId = '';
    if (text(payload.actorUserId).trim()) {
      try { actorId = loadActor(spreadsheet, payload.actorUserId, '').id; } catch (error) { actorId = ''; }
    }
    var products = [];
    var components = [];
    var balances = [];
    var warehouses = zeroWarehouses(spreadsheet);
    payload.products.forEach(function (item) {
      var source = item || {};
      var deferred = source.salesComponents;
      var copy = {};
      Object.keys(source).forEach(function (key) {
        if (key !== 'salesComponents') copy[key] = source[key];
      });
      var built = buildProduct(spreadsheet, copy, products, { skipAgentPermission: true, actor: null });
      built.product.salesComponents = deferred || [];
      products.push(built.product);
      balances = withZeros(balances, built.product.id, warehouses);
    });
    products.forEach(function (product) {
      product.salesComponents = normalizeComponents(product.id, product.salesComponents, products);
    });
    products.forEach(function (product) {
      components = componentRows(components, product.id, product.salesComponents);
    });
    persist(spreadsheet, products, components, balances);
    systemAudit(spreadsheet, {
      userId: actorId,
      action: 'products.bootstrap',
      entityType: 'product',
      entityId: 'products',
      reference: '',
      before: '',
      after: String(products.length) + ' products',
      requestId: requestId
    });
    return snapshot(assemble(spreadsheet));
  }

  function create(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot add products.');
    var current = assemble(spreadsheet);
    var built = buildProduct(spreadsheet, payload, current.products, { actor: actor });
    var products = current.products.concat([built.product]);
    var components = componentRows(current.salesComponents, built.product.id, built.product.salesComponents);
    var balances = withZeros(current.inventoryBalances, built.product.id, zeroWarehouses(spreadsheet));
    persist(spreadsheet, products, components, balances);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'products.create',
      entityType: 'product',
      entityId: built.product.id,
      reference: built.product.sku,
      before: '',
      after: built.product.name + ' · ' + built.product.sku,
      requestId: requestId
    });
    return snapshot(assemble(spreadsheet));
  }

  function findProduct(products, id) {
    var found = null;
    products.forEach(function (product) { if (product.id === id) found = product; });
    return found;
  }

  function has(payload, key) {
    return Object.prototype.hasOwnProperty.call(payload || {}, key);
  }

  function update(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot update products.');
    var current = assemble(spreadsheet);
    var id = text(payload.id).trim();
    var existing = findProduct(current.products, id);
    if (!existing) throw appError('NOT_FOUND', 'Product was not found.');
    var agentPrice = existing.agentPrice;
    if (has(payload, 'agentPrice')) {
      requireAgentPrice(spreadsheet, actor);
      var parsedAgent = moneyOrEmpty(payload.agentPrice);
      if (parsedAgent === false) throw appError('VALIDATION_ERROR', 'Agent Price cannot be negative.');
      agentPrice = parsedAgent;
    }
    var name = has(payload, 'name') ? text(payload.name).trim() : existing.name;
    if (!name) throw appError('VALIDATION_ERROR', 'Product name is required');
    var sku = existing.sku;
    if (has(payload, 'sku')) {
      var next = text(payload.sku).trim();
      if (next && next !== existing.sku) {
        if (productIsUsed(spreadsheet, id)) throw appError('VALIDATION_ERROR', 'SKU cannot be changed');
        if (skuTaken(current.products, next, id)) throw appError('VALIDATION_ERROR', 'SKU already exists');
        sku = next;
      }
    }
    var selling = existing.sellingPrice;
    if (has(payload, 'sellingPrice')) {
      var parsedSelling = money(payload.sellingPrice);
      if (parsedSelling === null) throw appError('VALIDATION_ERROR', 'Selling Price cannot be negative.');
      selling = parsedSelling;
    }
    var wholesale = existing.wholesalePrice;
    if (has(payload, 'wholesalePrice')) {
      var parsedWholesale = money(payload.wholesalePrice);
      if (parsedWholesale === null) throw appError('VALIDATION_ERROR', 'Wholesale price cannot be negative.');
      wholesale = parsedWholesale;
    }
    var unitTouched = ['unit', 'purchaseUnit', 'purchaseConversionQty', 'purchaseCost', 'costPrice'].some(function (key) {
      return has(payload, key);
    });
    var unit = normalizeUnit(has(payload, 'unit') ? payload.unit : existing.unit) || existing.unit;
    var purchaseUnit = normalizeUnit(has(payload, 'purchaseUnit') ? payload.purchaseUnit : (existing.purchaseUnit || unit)) || unit;
    var conversion = conversionQty(
      unit,
      purchaseUnit,
      has(payload, 'purchaseConversionQty') ? payload.purchaseConversionQty : existing.purchaseConversionQty
    );
    var purchaseCost = existing.purchaseCost;
    var costPrice = existing.costPrice;
    var costSource = existing.costSource === 'bom' ? 'bom' : 'manual';
    if (costSource !== 'bom' && unitTouched) {
      if (has(payload, 'purchaseCost')) {
        var parsedPurchase = money(payload.purchaseCost);
        if (parsedPurchase === null) throw appError('VALIDATION_ERROR', 'Cost Price cannot be negative.');
        purchaseCost = parsedPurchase;
        costPrice = round2(purchaseCost / conversion);
      } else if (has(payload, 'costPrice')) {
        var parsedCost = money(payload.costPrice);
        if (parsedCost === null) throw appError('VALIDATION_ERROR', 'Cost Price cannot be negative.');
        costPrice = parsedCost;
        purchaseCost = round2(costPrice * conversion);
      } else {
        purchaseCost = existing.purchaseCost;
        costPrice = round2(purchaseCost / conversion);
      }
    }
    var salesComponents = existing.salesComponents || [];
    if (has(payload, 'salesComponents')) {
      salesComponents = normalizeComponents(id, payload.salesComponents, current.products);
    }
    var status = has(payload, 'status') ? text(payload.status).trim() : existing.status;
    if (status !== 'active' && status !== 'inactive') throw appError('VALIDATION_ERROR', 'Product status is not valid.');
    var nextProduct = {
      id: existing.id,
      name: name,
      sku: sku,
      barcode: has(payload, 'barcode') ? text(payload.barcode).trim() : existing.barcode,
      categoryId: has(payload, 'categoryId') ? requireCategory(spreadsheet, payload.categoryId) : existing.categoryId,
      unit: unitTouched ? unit : existing.unit,
      purchaseUnit: unitTouched ? purchaseUnit : (existing.purchaseUnit || existing.unit),
      purchaseConversionQty: unitTouched ? conversion : existing.purchaseConversionQty,
      purchaseCost: costSource === 'bom' ? existing.purchaseCost : (unitTouched ? purchaseCost : existing.purchaseCost),
      costPrice: costSource === 'bom' ? existing.costPrice : (unitTouched ? costPrice : existing.costPrice),
      costSource: costSource,
      sellingPrice: selling,
      wholesalePrice: wholesale,
      sellable: has(payload, 'sellable') ? payload.sellable !== false : existing.sellable !== false,
      reorderLevel: has(payload, 'reorderLevel') ? level(payload.reorderLevel, existing.reorderLevel) : existing.reorderLevel,
      trackBatch: has(payload, 'trackBatch') ? Boolean(payload.trackBatch) : existing.trackBatch,
      trackExpiry: has(payload, 'trackExpiry') ? Boolean(payload.trackExpiry) : existing.trackExpiry,
      status: status,
      accent: existing.accent,
      salesComponents: salesComponents
    };
    if (existing.imageFileId) nextProduct.imageFileId = existing.imageFileId;
    if (agentPrice !== undefined) nextProduct.agentPrice = agentPrice;
    var products = current.products.map(function (product) { return product.id === id ? nextProduct : product; });
    var components = has(payload, 'salesComponents')
      ? componentRows(current.salesComponents, id, salesComponents)
      : current.salesComponents;
    persist(spreadsheet, products, components, current.inventoryBalances);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'products.update',
      entityType: 'product',
      entityId: id,
      reference: nextProduct.sku,
      before: existing.name + ' · ' + existing.sku,
      after: nextProduct.name + ' · ' + nextProduct.sku,
      requestId: requestId
    });
    return snapshot(assemble(spreadsheet));
  }

  function setStatus(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot change product status.');
    var current = assemble(spreadsheet);
    var id = text(payload.id).trim();
    var existing = findProduct(current.products, id);
    if (!existing) throw appError('NOT_FOUND', 'Product was not found.');
    var status = text(payload.status).trim();
    if (status !== 'active' && status !== 'inactive') throw appError('VALIDATION_ERROR', 'Product status is not valid.');
    var products = current.products.map(function (product) {
      if (product.id !== id) return product;
      var next = {};
      Object.keys(product).forEach(function (key) { next[key] = product[key]; });
      next.status = status;
      return next;
    });
    persist(spreadsheet, products, current.salesComponents, current.inventoryBalances);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'products.setStatus',
      entityType: 'product',
      entityId: id,
      reference: existing.sku,
      before: existing.status,
      after: status,
      requestId: requestId
    });
    return snapshot(assemble(spreadsheet));
  }

  function saveAgentPrices(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot change product prices.');
    if (!actorMay(spreadsheet, actor, 'agent.manage')) throw appError('FORBIDDEN', 'You cannot change product prices.');
    var rows = payload && Array.isArray(payload.rows) ? payload.rows : null;
    if (!rows || !rows.length) throw appError('VALIDATION_ERROR', 'No price changes to save.');
    var current = assemble(spreadsheet);
    var agentUpdates = {};
    var sellingUpdates = {};
    var wholesaleUpdates = {};
    var seen = {};
    rows.forEach(function (row) {
      var product = findProduct(current.products, text(row && row.productId).trim());
      if (!product) throw appError('VALIDATION_ERROR', 'Product not found');
      var touched = false;
      if (has(row, 'agentPrice')) {
        var parsedAgent = moneyOrEmpty(row.agentPrice);
        if (parsedAgent === false) throw appError('VALIDATION_ERROR', 'Agent Price cannot be negative.');
        agentUpdates[product.id] = parsedAgent;
        touched = true;
      }
      if (has(row, 'sellingPrice')) {
        var parsedSelling = money(row.sellingPrice);
        if (parsedSelling === null) throw appError('VALIDATION_ERROR', 'Selling Price cannot be negative.');
        sellingUpdates[product.id] = parsedSelling;
        touched = true;
      }
      if (has(row, 'wholesalePrice')) {
        var parsedWholesale = money(row.wholesalePrice);
        if (parsedWholesale === null) throw appError('VALIDATION_ERROR', 'Wholesale Price cannot be negative.');
        wholesaleUpdates[product.id] = parsedWholesale;
        touched = true;
      }
      if (!touched) throw appError('VALIDATION_ERROR', 'No price changes to save.');
      var nextSelling = Object.prototype.hasOwnProperty.call(sellingUpdates, product.id) ? sellingUpdates[product.id] : product.sellingPrice;
      var nextAgent = Object.prototype.hasOwnProperty.call(agentUpdates, product.id) ? agentUpdates[product.id] : product.agentPrice;
      if (nextAgent !== undefined && nextAgent !== null && round2(nextAgent) > round2(nextSelling || 0)) {
        throw appError('VALIDATION_ERROR', 'Agent Price cannot be higher than Selling Price.');
      }
      seen[product.id] = true;
    });
    var products = current.products.map(function (product) {
      if (!seen[product.id]) return product;
      var next = {};
      Object.keys(product).forEach(function (key) { next[key] = product[key]; });
      if (Object.prototype.hasOwnProperty.call(agentUpdates, product.id)) {
        if (agentUpdates[product.id] === undefined) delete next.agentPrice;
        else next.agentPrice = agentUpdates[product.id];
      }
      if (Object.prototype.hasOwnProperty.call(sellingUpdates, product.id)) next.sellingPrice = sellingUpdates[product.id];
      if (Object.prototype.hasOwnProperty.call(wholesaleUpdates, product.id)) next.wholesalePrice = wholesaleUpdates[product.id];
      return next;
    });
    persist(spreadsheet, products, current.salesComponents, current.inventoryBalances);
    var count = Object.keys(seen).length;
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'products.saveAgentPrices',
      entityType: 'product',
      entityId: 'products',
      reference: '',
      before: '',
      after: String(count) + ' products',
      requestId: requestId
    });
    return snapshot(assemble(spreadsheet));
  }

  function imageExtension(mime) {
    if (mime === 'image/png') return '.png';
    if (mime === 'image/webp') return '.webp';
    return '.jpg';
  }

  function decodeImageBase64(b64) {
    if (typeof Utilities !== 'undefined' && Utilities.base64Decode) return Utilities.base64Decode(b64);
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
    throw appError('INTERNAL_ERROR', 'Base64 decoding is unavailable.');
  }

  function encodeImageBase64(bytes) {
    if (typeof Utilities !== 'undefined' && Utilities.base64Encode) return Utilities.base64Encode(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    throw appError('INTERNAL_ERROR', 'Base64 encoding is unavailable.');
  }

  function parseProductImage(dataUrl, fileName, productId) {
    var value = text(dataUrl).trim();
    if (!value) throw appError('VALIDATION_ERROR', 'Upload a product image.');
    var match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) throw appError('VALIDATION_ERROR', PRODUCT_IMAGE_MESSAGE);
    var mime = match[1].toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (!PRODUCT_IMAGE_TYPES[mime]) throw appError('VALIDATION_ERROR', PRODUCT_IMAGE_MESSAGE);
    var b64 = match[2].replace(/\s/g, '');
    var padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    var size = Math.floor((b64.length * 3) / 4) - padding;
    if (!(size > 0) || size > PRODUCT_IMAGE_MAX_BYTES) {
      throw appError('VALIDATION_ERROR', PRODUCT_IMAGE_MESSAGE);
    }
    var id = text(productId).trim() || 'product';
    var uploadedName = text(fileName).trim();
    return {
      mime: mime,
      bytes: decodeImageBase64(b64),
      name: id + imageExtension(mime),
      originalName: uploadedName
    };
  }

  function imageBlob(parsed) {
    if (typeof Utilities !== 'undefined' && Utilities.newBlob) {
      return Utilities.newBlob(parsed.bytes, parsed.mime, parsed.name);
    }
    return {
      getBytes: function () { return parsed.bytes; },
      getContentType: function () { return parsed.mime; },
      getName: function () { return parsed.name; }
    };
  }

  function requireDrive() {
    if (!drive) throw appError('INTERNAL_ERROR', 'Product image storage is unavailable.');
    return drive;
  }

  function storedImageFileId(product) {
    return text(product && product.imageFileId).trim();
  }

  function belongsToProductImages(fileId) {
    var id = text(fileId).trim();
    if (!id || !drive || !drive.fileBelongsToChildFolder) return false;
    return drive.fileBelongsToChildFolder(id, PRODUCT_IMAGE_FOLDER);
  }

  function trashOwnedProductImage(fileId) {
    var id = text(fileId).trim();
    if (!id || !belongsToProductImages(id)) return;
    drive.deleteFile(id);
  }

  function logImageCleanupFailure(action, requestId, fileId, error) {
    var safe = toSafeError(error);
    console.log(JSON.stringify({
      requestId: requestId || '',
      action: action,
      timestamp: nowIso(),
      status: 'cleanup_failed',
      errorCode: safe.code,
      fileId: text(fileId).trim()
    }));
  }

  function logImageAuditFailure(action, requestId, error) {
    var safe = toSafeError(error);
    console.log(JSON.stringify({
      requestId: requestId || '',
      action: action,
      timestamp: nowIso(),
      status: 'audit_failed',
      errorCode: safe.code
    }));
  }

  // Never trash a Drive file unless it is in this environment's ProductImages folder.
  // Cleanup failures are logged and must not replace a prior persist error.
  function cleanupOwnedProductImage(fileId, action, requestId) {
    try {
      trashOwnedProductImage(fileId);
    } catch (error) {
      logImageCleanupFailure(action, requestId, fileId, error);
    }
  }

  // After the product image reference is persisted, audit is best-effort.
  // A later audit failure must not reverse the committed imageFileId or
  // be reported as a normal operation failure.
  function writeImageAudit(spreadsheet, entry) {
    try {
      systemAudit(spreadsheet, entry);
    } catch (error) {
      logImageAuditFailure(entry && entry.action, entry && entry.requestId, error);
    }
  }

  function uploadProductImageFile(parsed) {
    var storage = requireDrive();
    storage.createChildFolder(PRODUCT_IMAGE_FOLDER);
    var uploaded = storage.uploadFile(PRODUCT_IMAGE_FOLDER, imageBlob(parsed), parsed.name);
    return uploaded.id;
  }

  function writeProductImageFileId(spreadsheet, productId, imageFileId) {
    // Image mutations persist only Products.imageFileId. Rewriting
    // SalesComponents or InventoryBalances would expose a partial-write
    // window where Products already names a new Drive file.
    repository.writeProductImageFileId(spreadsheet, productId, imageFileId);
    return snapshot(assemble(spreadsheet));
  }

  function persistImageFileId(spreadsheet, productId, imageFileId, actor, action, requestId, before, after) {
    var result = writeProductImageFileId(spreadsheet, productId, imageFileId);
    writeImageAudit(spreadsheet, {
      userId: actor.id,
      action: action,
      entityType: 'product',
      entityId: productId,
      reference: '',
      before: before || '',
      after: after || '',
      requestId: requestId
    });
    return result;
  }

  function loadProductImageRef(spreadsheet, payload) {
    requireAnyPermission(
      spreadsheet,
      payload.actorUserId,
      PRODUCT_IMAGE_GET_KEYS,
      'You cannot view this product image.'
    );
    var current = assemble(spreadsheet);
    var product = findProduct(current.products, text(payload.productId || payload.id).trim());
    if (!product) throw appError('NOT_FOUND', 'Product was not found.');
    return {
      productId: product.id,
      name: product.name,
      imageFileId: storedImageFileId(product)
    };
  }

  function readStoredProductImage(ref) {
    var value = text(ref.imageFileId).trim();
    if (!value) throw appError('NOT_FOUND', 'Product image was not found.');
    var storage = requireDrive();
    if (!storage.verifyFileExists(value) || !belongsToProductImages(value)) {
      throw appError('NOT_FOUND', 'Product image was not found.');
    }
    var file;
    try {
      file = storage.readFileBytes(value);
    } catch (error) {
      throw appError('NOT_FOUND', 'Product image was not found.');
    }
    var mime = text(file && file.mimeType).trim().toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (!PRODUCT_IMAGE_TYPES[mime]) {
      throw appError('VALIDATION_ERROR', PRODUCT_IMAGE_MESSAGE);
    }
    var bytes = file.bytes;
    var length = bytes && (bytes.length || bytes.byteLength) ? (bytes.length || bytes.byteLength) : 0;
    if (!(length > 0) || length > PRODUCT_IMAGE_MAX_BYTES) {
      throw appError('VALIDATION_ERROR', PRODUCT_IMAGE_MESSAGE);
    }
    return {
      productId: ref.productId,
      fileName: file.name || ref.productId + imageExtension(mime),
      mimeType: mime,
      dataUrl: 'data:' + mime + ';base64,' + encodeImageBase64(bytes)
    };
  }

  function uploadImage(spreadsheet, payload, requestId) {
    var actor = requirePermission(spreadsheet, payload.actorUserId, 'products.edit', 'You cannot change product images.');
    var current = assemble(spreadsheet);
    var product = findProduct(current.products, text(payload.productId || payload.id).trim());
    if (!product) throw appError('NOT_FOUND', 'Product was not found.');
    if (storedImageFileId(product)) throw appError('VALIDATION_ERROR', 'Product already has an image.');
    var parsed = parseProductImage(payload.dataUrl, payload.fileName, product.id);
    var imageFileId = uploadProductImageFile(parsed);
    var result;
    // Persist the new reference before treating the upload as committed. A
    // Sheets failure must attempt to clean up only the newly uploaded
    // ProductImages file and must not touch any other product image.
    try {
      result = writeProductImageFileId(spreadsheet, product.id, imageFileId);
    } catch (error) {
      cleanupOwnedProductImage(imageFileId, 'products.uploadImage', requestId);
      throw error;
    }
    writeImageAudit(spreadsheet, {
      userId: actor.id,
      action: 'products.uploadImage',
      entityType: 'product',
      entityId: product.id,
      reference: '',
      before: '',
      after: imageFileId,
      requestId: requestId
    });
    return result;
  }

  function replaceImage(spreadsheet, payload, requestId) {
    var actor = requirePermission(spreadsheet, payload.actorUserId, 'products.edit', 'You cannot change product images.');
    var current = assemble(spreadsheet);
    var product = findProduct(current.products, text(payload.productId || payload.id).trim());
    if (!product) throw appError('NOT_FOUND', 'Product was not found.');
    var previous = storedImageFileId(product);
    if (!previous) throw appError('NOT_FOUND', 'Product image was not found.');
    var parsed = parseProductImage(payload.dataUrl, payload.fileName, product.id);
    var imageFileId = uploadProductImageFile(parsed);
    var result;
    // Persist the new reference before trashing the previous file. A Sheets
    // failure must leave the old image reachable and attempt to clean up only
    // the newly uploaded ProductImages file.
    try {
      result = writeProductImageFileId(spreadsheet, product.id, imageFileId);
    } catch (error) {
      cleanupOwnedProductImage(imageFileId, 'products.replaceImage', requestId);
      throw error;
    }
    writeImageAudit(spreadsheet, {
      userId: actor.id,
      action: 'products.replaceImage',
      entityType: 'product',
      entityId: product.id,
      reference: '',
      before: previous,
      after: imageFileId,
      requestId: requestId
    });
    cleanupOwnedProductImage(previous, 'products.replaceImage', requestId);
    return result;
  }

  function removeImage(spreadsheet, payload, requestId) {
    var actor = requirePermission(spreadsheet, payload.actorUserId, 'products.edit', 'You cannot change product images.');
    var current = assemble(spreadsheet);
    var product = findProduct(current.products, text(payload.productId || payload.id).trim());
    if (!product) throw appError('NOT_FOUND', 'Product was not found.');
    var previous = storedImageFileId(product);
    if (!previous) throw appError('NOT_FOUND', 'Product image was not found.');
    // Clear the product reference before trashing Drive. Persistence failure
    // must not delete the file still named on the product row.
    var result = writeProductImageFileId(spreadsheet, product.id, '');
    writeImageAudit(spreadsheet, {
      userId: actor.id,
      action: 'products.removeImage',
      entityType: 'product',
      entityId: product.id,
      reference: '',
      before: previous,
      after: '',
      requestId: requestId
    });
    cleanupOwnedProductImage(previous, 'products.removeImage', requestId);
    return result;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    if (action === 'products.getImage') {
      var ref = locked(function (spreadsheet) {
        return loadProductImageRef(spreadsheet, payload);
      });
      return okEnvelope(readStoredProductImage(ref));
    }
    return locked(function (spreadsheet) {
      if (action === 'products.list') return okEnvelope(snapshot(assemble(spreadsheet)));
      if (action === 'products.get') {
        var state = assemble(spreadsheet);
        var product = findProduct(state.products, text(payload.id).trim());
        if (!product) throw appError('NOT_FOUND', 'Product was not found.');
        return okEnvelope({
          product: product,
          inventoryBalances: state.inventoryBalances.filter(function (row) { return row.productId === product.id; })
        });
      }
      var result;
      if (action === 'products.bootstrap') result = bootstrap(spreadsheet, payload, requestId);
      else if (action === 'products.create') result = create(spreadsheet, payload, requestId);
      else if (action === 'products.update') result = update(spreadsheet, payload, requestId);
      else if (action === 'products.setStatus') result = setStatus(spreadsheet, payload, requestId);
      else if (action === 'products.saveAgentPrices') result = saveAgentPrices(spreadsheet, payload, requestId);
      else if (action === 'products.uploadImage') result = uploadImage(spreadsheet, payload, requestId);
      else if (action === 'products.replaceImage') result = replaceImage(spreadsheet, payload, requestId);
      else if (action === 'products.removeImage') result = removeImage(spreadsheet, payload, requestId);
      else return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
      return okEnvelope(result);
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
