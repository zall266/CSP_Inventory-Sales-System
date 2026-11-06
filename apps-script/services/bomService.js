// Module 7 BOM / recipes.
// Saves the recipe the BOM screen already edits, including AUTO / MANUAL.
// Product cost follows masterData.ts applyBomCosts: component quantity converted
// to the component base unit, times that product's stored base unit cost, without
// wastage. Up to eight passes refresh a component's stored cost when that
// component has its own active BOM. Child quantities are not copied into the parent.
// This module does not post inventory.

var BOM_ACTIONS = {
  'boms.list': true,
  'boms.get': true,
  'boms.bootstrap': true,
  'boms.create': true,
  'boms.update': true,
  'boms.setStatus': true
};

var BOM_UNIT_ALIASES = {
  g: 'G', gram: 'G', grams: 'G',
  kg: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG',
  ml: 'ML', millilitre: 'ML', milliliter: 'ML', millilitres: 'ML', milliliters: 'ML',
  l: 'L', litre: 'L', liter: 'L', litres: 'L', liters: 'L',
  pc: 'PCS', pcs: 'PCS', piece: 'PCS', pieces: 'PCS',
  bag: 'BAG', bags: 'BAG', bottle: 'BOTTLE', bottles: 'BOTTLE',
  box: 'BOX', boxes: 'BOX', carton: 'CARTON', cartons: 'CARTON',
  roll: 'ROLL', rolls: 'ROLL', pack: 'PACKS', packs: 'PACKS', tin: 'TIN', tins: 'TIN'
};

var BOM_UNIT_META = {
  G: { family: 'weight', factor: 1 },
  KG: { family: 'weight', factor: 1000 },
  ML: { family: 'volume', factor: 1 },
  L: { family: 'volume', factor: 1000 },
  PCS: { family: 'count', factor: 1 },
  PACKS: { family: 'count', factor: 1 },
  TIN: { family: 'count', factor: 1 },
  BAG: { family: 'pack', factor: 1 },
  BOTTLE: { family: 'pack', factor: 1 },
  BOX: { family: 'pack', factor: 1 },
  CARTON: { family: 'pack', factor: 1 },
  ROLL: { family: 'pack', factor: 1 }
};

function createBomService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createBomRepository(sheets);
  var products = createProductRepository(sheets);
  var inventory = createInventoryRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(BOM_ACTIONS[action]);
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

  function newId(prefix) {
    return prefix + '_' + createId().replace(/-/g, '').slice(0, 10);
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function normalizeUnit(unit) {
    var raw = text(unit).trim();
    if (!raw) return '';
    return BOM_UNIT_ALIASES[raw.toLowerCase()] || raw.toUpperCase();
  }

  function unitsEqual(a, b) {
    var left = normalizeUnit(a);
    var right = normalizeUnit(b);
    return Boolean(left) && left === right;
  }

  function purchaseConversionQty(product) {
    if (unitsEqual(product.unit, product.purchaseUnit || product.unit)) return 1;
    var qty = Number(product.purchaseConversionQty);
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
  }

  function baseUnitCost(product) {
    var conversion = purchaseConversionQty(product);
    var purchaseCost = product.purchaseCost;
    if (purchaseCost !== undefined && purchaseCost !== null && Number.isFinite(Number(purchaseCost)) && conversion > 0) {
      return round2(Number(purchaseCost) / conversion);
    }
    return round2(product.costPrice || 0);
  }

  function qtyToBaseUnit(qty, fromUnit, product) {
    if (!Number.isFinite(qty)) return null;
    var from = normalizeUnit(fromUnit) || normalizeUnit(product.unit);
    var base = normalizeUnit(product.unit);
    if (!from || !base) return null;
    if (from === base) return qty;
    var fromMeta = BOM_UNIT_META[from];
    var baseMeta = BOM_UNIT_META[base];
    if (fromMeta && baseMeta && fromMeta.family === baseMeta.family && fromMeta.family !== 'pack') {
      return (qty * fromMeta.factor) / baseMeta.factor;
    }
    var purchase = normalizeUnit(product.purchaseUnit || '');
    var conversion = purchaseConversionQty(product);
    if (purchase && from === purchase && conversion > 0) return qty * conversion;
    if (purchase && from === base && purchase === from) return qty;
    return null;
  }

  function productMap(list) {
    var map = {};
    list.forEach(function (product) { map[product.id] = product; });
    return map;
  }

  function bomLineCost(list, item, withWastage) {
    var material = null;
    list.forEach(function (product) {
      if (product.id === item.productId) material = product;
    });
    var converted = material ? qtyToBaseUnit(item.qty, item.unit, material) : null;
    var qty = material ? (converted === null ? item.qty : converted) : item.qty;
    var used = withWastage ? qty * (1 + (Number(item.wastagePct) || 0) / 100) : qty;
    var cost = baseUnitCost(material || { costPrice: 0, unit: item.unit });
    return used * cost;
  }

  function bomMaterialCost(list, bom, qty, withWastage) {
    var factor = bom.outputQty > 0 ? qty / bom.outputQty : 0;
    var sum = 0;
    (bom.items || []).forEach(function (item) {
      sum += bomLineCost(list, {
        productId: item.productId,
        qty: item.qty * factor,
        unit: item.unit,
        wastagePct: item.wastagePct
      }, withWastage);
    });
    return round2(sum);
  }

  function bomUnitCost(list, bom) {
    if (!(bom.outputQty > 0)) return 0;
    return round2(bomMaterialCost(list, bom, bom.outputQty, false) / bom.outputQty);
  }

  function activeBomForProduct(boms, productId) {
    var match = null;
    boms.forEach(function (bom) {
      if (!match && bom.productId === productId && bom.status === 'active') match = bom;
    });
    return match;
  }

  function productHasBom(boms, productId) {
    return Boolean(activeBomForProduct(boms, productId));
  }

  function applyBomCosts(list, boms) {
    var next = productMap(list);
    for (var pass = 0; pass < 8; pass += 1) {
      var changed = false;
      boms.forEach(function (bom) {
        if (bom.status !== 'active') return;
        var current = next[bom.productId];
        if (!current) return;
        var values = Object.keys(next).map(function (id) { return next[id]; });
        var costPrice = bomUnitCost(values, bom);
        if (current.costSource !== 'bom' || current.costPrice !== costPrice) {
          var updated = {};
          Object.keys(current).forEach(function (key) { updated[key] = current[key]; });
          updated.costSource = 'bom';
          updated.costPrice = costPrice;
          next[current.id] = updated;
          changed = true;
        }
      });
      if (!changed) break;
    }
    list.forEach(function (product) {
      if (productHasBom(boms, product.id)) return;
      var current = next[product.id];
      if (current && current.costSource === 'bom') {
        var reverted = {};
        Object.keys(current).forEach(function (key) { reverted[key] = current[key]; });
        reverted.costSource = 'manual';
        next[product.id] = reverted;
      }
    });
    return list.map(function (product) { return next[product.id] || product; });
  }

  function costRows(list) {
    return list.map(function (product) {
      return { id: product.id, costPrice: product.costPrice, costSource: product.costSource === 'bom' ? 'bom' : 'manual' };
    });
  }

  function snapshot(spreadsheet) {
    var list = products.readProducts(spreadsheet);
    return { boms: repository.readBoms(spreadsheet), productCosts: costRows(list), products: list };
  }

  function publicSnapshot(state) {
    return { boms: state.boms, productCosts: state.productCosts };
  }

  function findProduct(list, id) {
    var match = null;
    list.forEach(function (product) {
      if (product.id === id) match = product;
    });
    return match;
  }

  function findBom(boms, id) {
    var match = null;
    boms.forEach(function (bom) {
      if (bom.id === id) match = bom;
    });
    return match;
  }

  function sheetSignature(spreadsheet, name, pick) {
    var sheet = sheets.getSheet(spreadsheet, name);
    if (!sheet) return '';
    return sheets.readObjects(sheet).map(pick).join(';');
  }

  function ledgerFingerprint(spreadsheet) {
    return {
      balances: products.readBalances(spreadsheet).map(function (row) {
        return row.productId + '|' + row.warehouseId + '|' + round2(row.qty);
      }).join(','),
      movements: inventory.readMovements(spreadsheet).map(function (row) { return row.id; }).join(','),
      display: sheetSignature(spreadsheet, 'DisplayStocks', function (row) { return text(row.id) + ':' + text(row.qty); }),
      production: sheetSignature(spreadsheet, 'ProductionBalances', function (row) { return text(row.id) + ':' + text(row.quantity); }),
      occupancies: sheetSignature(spreadsheet, 'SlotOccupancies', function (row) { return text(row.id) + ':' + text(row.slotId); })
    };
  }

  function assertLedgerUntouched(spreadsheet, before) {
    var after = ledgerFingerprint(spreadsheet);
    if (before.balances !== after.balances || before.movements !== after.movements || before.display !== after.display || before.production !== after.production || before.occupancies !== after.occupancies) {
      throw appError('INTERNAL_ERROR', 'BOM save must not change inventory.');
    }
  }

  function costDelta(before, after) {
    var prev = productMap(before);
    var changes = [];
    after.forEach(function (product) {
      var old = prev[product.id];
      if (!old) return;
      if (old.costPrice !== product.costPrice || (old.costSource === 'bom' ? 'bom' : 'manual') !== (product.costSource === 'bom' ? 'bom' : 'manual')) {
        changes.push({
          id: product.id,
          beforeCost: old.costPrice,
          beforeSource: old.costSource === 'bom' ? 'bom' : 'manual',
          costPrice: product.costPrice,
          costSource: product.costSource === 'bom' ? 'bom' : 'manual'
        });
      }
    });
    return changes;
  }

  function bomSummary(bom) {
    return {
      id: bom.id,
      name: bom.name,
      productId: bom.productId,
      outputQty: bom.outputQty,
      outputUnit: bom.outputUnit,
      status: bom.status,
      items: (bom.items || []).map(function (item) {
        return {
          id: item.id,
          productId: item.productId,
          qty: item.qty,
          unit: item.unit,
          wastagePct: item.wastagePct,
          consumptionMethod: item.consumptionMethod
        };
      })
    };
  }

  function persist(spreadsheet, boms, priced, beforeLedger) {
    repository.writeBoms(spreadsheet, boms);
    products.writeProducts(spreadsheet, priced);
    assertLedgerUntouched(spreadsheet, beforeLedger);
  }

  function lineFrom(raw, list) {
    var productId = text(raw && raw.productId).trim();
    if (!productId) return null;
    var qty = Number(raw.qty);
    if (!Number.isFinite(qty) || !(qty > 0)) return null;
    if (!findProduct(list, productId)) throw appError('NOT_FOUND', 'Product was not found.');
    var product = findProduct(list, productId);
    var unit = text(raw.unit).trim() || product.unit || 'KG';
    var wastage = Number(raw.wastagePct);
    return {
      productId: productId,
      qty: qty,
      unit: unit,
      wastagePct: Number.isFinite(wastage) ? wastage : 0,
      notes: text(raw.notes),
      consumptionMethod: text(raw.consumptionMethod).trim() === 'MANUAL' ? 'MANUAL' : 'AUTO'
    };
  }

  function buildItems(payload, list) {
    if (!Array.isArray(payload.items)) throw appError('VALIDATION_ERROR', 'A BOM needs a finished product and at least one material.');
    var items = [];
    payload.items.forEach(function (raw) {
      var line = lineFrom(raw, list);
      if (line) items.push(line);
    });
    return items;
  }

  function requireOutput(payload, product) {
    var outputQty = Number(payload.outputQty);
    if (!Number.isFinite(outputQty)) throw appError('VALIDATION_ERROR', 'Enter a quantity');
    var outputUnit = text(payload.outputUnit).trim() || (product && product.unit) || 'KG';
    return { outputQty: outputQty, outputUnit: outputUnit };
  }

  function requireProduct(payload, list) {
    var productId = text(payload.productId).trim();
    if (!productId) throw appError('VALIDATION_ERROR', 'A BOM needs a finished product and at least one material.');
    var product = findProduct(list, productId);
    if (!product) throw appError('NOT_FOUND', 'Product was not found.');
    return product;
  }

  function seedItem(id, productId, qty, unit, wastagePct, notes) {
    return {
      id: id,
      productId: productId,
      qty: qty,
      unit: unit,
      wastagePct: wastagePct || 0,
      notes: notes || '',
      consumptionMethod: 'AUTO'
    };
  }

  function seedBoms() {
    return [
      { id: 'bom-cp', name: 'Chocolate Powder — 100 KG', productId: 'p-cp', outputQty: 100, outputUnit: 'KG', status: 'active', notes: 'Standard blending recipe for chocolate premix.', items: [
        seedItem('bi1', 'p-cocoa', 20, 'KG', 2, 'Dutch process cocoa'),
        seedItem('bi2', 'p-milkpw', 15, 'KG', 0, ''),
        seedItem('bi3', 'p-sugar', 50, 'KG', 0, ''),
        seedItem('bi4', 'p-other', 15, 'KG', 1, 'Stabiliser and flavour'),
        seedItem('bi5', 'p-pouch', 10, 'pcs', 0, '1kg pouches')
      ] },
      { id: 'bom-mt', name: 'Matcha Powder — 50 KG', productId: 'p-mt', outputQty: 50, outputUnit: 'KG', status: 'active', notes: 'Ceremonial blend cut with milk powder for cafe use.', items: [
        seedItem('bi6', 'p-matcha-raw', 18, 'KG', 1, ''),
        seedItem('bi7', 'p-sugar', 20, 'KG', 0, ''),
        seedItem('bi8', 'p-milkpw', 10, 'KG', 0, ''),
        seedItem('bi9', 'p-other', 2, 'KG', 0, ''),
        seedItem('bi10', 'p-pouch', 5, 'pcs', 0, '')
      ] },
      { id: 'bom-wf', name: 'Waffle Premix — 80 KG', productId: 'p-wf', outputQty: 80, outputUnit: 'KG', status: 'active', notes: '', items: [
        seedItem('bi11', 'p-flour', 50, 'KG', 1, ''),
        seedItem('bi12', 'p-sugar', 15, 'KG', 0, ''),
        seedItem('bi13', 'p-milkpw', 10, 'KG', 0, ''),
        seedItem('bi14', 'p-other', 5, 'KG', 2, 'Baking powder mix')
      ] },
      { id: 'bom-pw', name: 'Pandan Waffle Premix — 80 KG', productId: 'p-pw', outputQty: 80, outputUnit: 'KG', status: 'active', notes: 'Pandan paste added at blending.', items: [
        seedItem('bi15', 'p-flour', 48, 'KG', 1, ''),
        seedItem('bi16', 'p-sugar', 14, 'KG', 0, ''),
        seedItem('bi17', 'p-other', 14, 'KG', 0, 'Includes milk solids'),
        seedItem('bi18', 'p-pp', 4, 'bottle', 0, 'Pandan paste')
      ] },
      { id: 'bom-pack-mt', name: 'Matcha — 45 packs', productId: 'p-pack-mt', outputQty: 45, outputUnit: 'packs', bulkYieldGrams: 3000, status: 'active', notes: 'Daily pack recipe. Yield 3,000g processed Matcha for 45 packs.', items: [
        seedItem('bi-mt-s', 'p-sugar', 1, 'KG', 0, ''),
        seedItem('bi-mt-m', 'p-milkpw', 0.5, 'KG', 0, ''),
        seedItem('bi-mt-r', 'p-matcha-raw', 0.3, 'KG', 0, ''),
        seedItem('bi-mt-o', 'p-other', 0.1, 'KG', 0, ''),
        seedItem('bi-mt-p', 'p-pouch', 45, 'pcs', 0, 'Retail pouches')
      ] },
      { id: 'bom-pack-cl', name: 'Chocolate Lava — 45 packs', productId: 'p-pack-cl', outputQty: 45, outputUnit: 'packs', bulkYieldGrams: 2000, status: 'active', notes: 'Daily pack recipe. Yield 2,000g processed Chocolate Lava for 45 packs.', items: [
        seedItem('bi-cl-s', 'p-sugar', 1.2, 'KG', 0, ''),
        seedItem('bi-cl-m', 'p-milkpw', 0.5, 'KG', 0, ''),
        seedItem('bi-cl-c', 'p-cp', 0.4, 'KG', 0, 'Chocolate powder'),
        seedItem('bi-cl-o', 'p-other', 0.08, 'KG', 0, ''),
        seedItem('bi-cl-p', 'p-pouch', 45, 'pcs', 0, '')
      ] },
      { id: 'bom-pack-st', name: 'Strawberry — 45 packs', productId: 'p-pack-st', outputQty: 45, outputUnit: 'packs', bulkYieldGrams: 3000, status: 'active', notes: 'Daily pack recipe. Yield 3,000g processed Strawberry for 45 packs.', items: [
        seedItem('bi-st-s', 'p-sugar', 0.8, 'KG', 0, ''),
        seedItem('bi-st-m', 'p-milkpw', 0.5, 'KG', 0, ''),
        seedItem('bi-st-r', 'p-st', 0.35, 'KG', 0, 'Strawberry powder'),
        seedItem('bi-st-o', 'p-other', 0.08, 'KG', 0, ''),
        seedItem('bi-st-p', 'p-pouch', 45, 'pcs', 0, '')
      ] },
      { id: 'bom-pack-mlt', name: 'Milk Tea — 45 packs', productId: 'p-pack-mlt', outputQty: 45, outputUnit: 'packs', bulkYieldGrams: 2800, status: 'active', notes: '', items: [
        seedItem('bi-mlt-s', 'p-sugar', 0.9, 'KG', 0, ''),
        seedItem('bi-mlt-m', 'p-milkpw', 0.6, 'KG', 0, ''),
        seedItem('bi-mlt-t', 'p-cf', 0.25, 'KG', 0, 'Tea/coffee base'),
        seedItem('bi-mlt-p', 'p-pouch', 45, 'pcs', 0, '')
      ] },
      { id: 'bom-pack-ch', name: 'Chocolate — 45 packs', productId: 'p-pack-ch', outputQty: 45, outputUnit: 'packs', bulkYieldGrams: 2500, status: 'active', notes: '', items: [
        seedItem('bi-ch-s', 'p-sugar', 1, 'KG', 0, ''),
        seedItem('bi-ch-m', 'p-milkpw', 0.4, 'KG', 0, ''),
        seedItem('bi-ch-c', 'p-cocoa', 0.35, 'KG', 0, ''),
        seedItem('bi-ch-p', 'p-pouch', 45, 'pcs', 0, '')
      ] }
    ];
  }

  function commitCosts(spreadsheet, boms, beforeProducts, beforeLedger, actor, action, beforeBom, afterBom, requestId) {
    var priced = applyBomCosts(beforeProducts, boms);
    var changes = costDelta(beforeProducts, priced);
    persist(spreadsheet, boms, priced, beforeLedger);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: action,
      entityType: 'bom',
      entityId: afterBom ? afterBom.id : 'boms',
      reference: afterBom ? afterBom.name : 'bootstrap',
      before: JSON.stringify({
        bom: beforeBom ? bomSummary(beforeBom) : null,
        costs: changes.map(function (row) {
          return { id: row.id, costPrice: row.beforeCost, costSource: row.beforeSource };
        })
      }),
      after: JSON.stringify({ bom: afterBom ? bomSummary(afterBom) : { count: boms.length }, costs: changes }),
      requestId: requestId
    });
    return publicSnapshot(snapshot(spreadsheet));
  }

  function bootstrap(spreadsheet, payload, requestId) {
    var actor = requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.view', 'You do not have permission to view the bill of materials.');
    repository.ensure(spreadsheet);
    if (repository.readBoms(spreadsheet).length) throw appError('CONFLICT', 'BOM recipes are already initialized.');
    var beforeLedger = ledgerFingerprint(spreadsheet);
    var beforeProducts = products.readProducts(spreadsheet);
    var boms = seedBoms();
    return commitCosts(spreadsheet, boms, beforeProducts, beforeLedger, actor, 'boms.bootstrap', null, null, requestId);
  }

  function create(spreadsheet, payload, requestId, actor) {
    var beforeProducts = products.readProducts(spreadsheet);
    if (!Array.isArray(payload.items) || !payload.items.length) {
      throw appError('VALIDATION_ERROR', 'A BOM needs a finished product and at least one material.');
    }
    var product = requireProduct(payload, beforeProducts);
    var output = requireOutput(payload, product);
    var items = buildItems(payload, beforeProducts).map(function (item) {
      item.id = newId('bi');
      return item;
    });
    var name = text(payload.name).trim() || (product.name + ' BOM');
    var bom = {
      id: newId('bom'),
      name: name,
      productId: product.id,
      outputQty: output.outputQty,
      outputUnit: output.outputUnit,
      status: 'active',
      notes: text(payload.notes),
      items: items
    };
    if (payload.bulkYieldGrams !== undefined && payload.bulkYieldGrams !== null && text(payload.bulkYieldGrams).trim() !== '') {
      var grams = Number(payload.bulkYieldGrams);
      if (Number.isFinite(grams)) bom.bulkYieldGrams = grams;
    }
    var beforeLedger = ledgerFingerprint(spreadsheet);
    var boms = [bom].concat(repository.readBoms(spreadsheet));
    var result = commitCosts(spreadsheet, boms, beforeProducts, beforeLedger, actor, 'boms.create', null, bom, requestId);
    result.bom = bom;
    return result;
  }

  function update(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var existing = findBom(repository.readBoms(spreadsheet), id);
    if (!existing) throw appError('NOT_FOUND', 'BOM not found.');
    var beforeProducts = products.readProducts(spreadsheet);
    var product = requireProduct(payload, beforeProducts);
    var output = requireOutput(payload, product);
    var items = buildItems(payload, beforeProducts).map(function (item) {
      item.id = newId('bi');
      return item;
    });
    var bom = {
      id: existing.id,
      name: text(payload.name),
      productId: product.id,
      outputQty: output.outputQty,
      outputUnit: output.outputUnit,
      status: existing.status,
      notes: text(payload.notes),
      items: items
    };
    if (payload.bulkYieldGrams !== undefined && payload.bulkYieldGrams !== null && text(payload.bulkYieldGrams).trim() !== '') {
      var grams = Number(payload.bulkYieldGrams);
      if (Number.isFinite(grams)) bom.bulkYieldGrams = grams;
    } else if (existing.bulkYieldGrams !== undefined) {
      bom.bulkYieldGrams = existing.bulkYieldGrams;
    }
    var beforeLedger = ledgerFingerprint(spreadsheet);
    var boms = repository.readBoms(spreadsheet).map(function (row) { return row.id === id ? bom : row; });
    var result = commitCosts(spreadsheet, boms, beforeProducts, beforeLedger, actor, 'boms.update', existing, bom, requestId);
    result.bom = bom;
    return result;
  }

  function setStatus(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var status = text(payload.status).trim();
    if (status !== 'active' && status !== 'inactive') throw appError('VALIDATION_ERROR', 'BOM status is not valid.');
    var existing = findBom(repository.readBoms(spreadsheet), id);
    if (!existing) throw appError('NOT_FOUND', 'BOM not found.');
    var bom = {
      id: existing.id,
      name: existing.name,
      productId: existing.productId,
      outputQty: existing.outputQty,
      outputUnit: existing.outputUnit,
      status: status,
      notes: existing.notes,
      items: existing.items
    };
    if (existing.bulkYieldGrams !== undefined) bom.bulkYieldGrams = existing.bulkYieldGrams;
    var beforeProducts = products.readProducts(spreadsheet);
    var beforeLedger = ledgerFingerprint(spreadsheet);
    var boms = repository.readBoms(spreadsheet).map(function (row) { return row.id === id ? bom : row; });
    var result = commitCosts(spreadsheet, boms, beforeProducts, beforeLedger, actor, 'boms.setStatus', existing, bom, requestId);
    result.bom = bom;
    return result;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'boms.list' || action === 'boms.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.view', 'You do not have permission to view the bill of materials.');
        repository.ensure(spreadsheet);
        var state = publicSnapshot(snapshot(spreadsheet));
        if (action === 'boms.get') {
          var bom = findBom(state.boms, text(payload.id).trim());
          if (!bom) throw appError('NOT_FOUND', 'BOM not found.');
          state.bom = bom;
        }
        return okEnvelope(state);
      }
      if (action === 'boms.bootstrap') return okEnvelope(bootstrap(spreadsheet, payload, requestId));
      requireKey(request);
      var result;
      if (action === 'boms.create') {
        result = create(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.create', 'You cannot create a BOM.'));
      } else if (action === 'boms.update') {
        result = update(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot edit a BOM.'));
      } else if (action === 'boms.setStatus') {
        result = setStatus(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot edit a BOM.'));
      } else {
        return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
      }
      return okEnvelope(result);
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
