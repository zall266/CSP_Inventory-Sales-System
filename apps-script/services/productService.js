// Module 3. Product behaviour matches db.createProduct, updateProduct,
// setProductStatus, and saveAgentPrices. There is no product permission key
// on the product screens, so any active user may create, edit, and change
// status. Agent price writes still require agent.manage. Owner keeps full access.
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
  'products.saveAgentPrices': true
};

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
      ['Purchases', 'items'],
      ['Receivings', 'items'],
      ['OpeningBalances', 'items'],
      ['StockMovements', 'productId'],
      ['ProductionOrders', 'productId'],
      ['PackingAssemblies', 'productId'],
      ['AgentSales', 'items'],
      ['Quotations', 'items'],
      ['DeliveryOrders', 'items'],
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

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
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
      else return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
      return okEnvelope(result);
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
