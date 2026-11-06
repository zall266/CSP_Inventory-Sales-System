// Packing and production quantity math. Matches src/features/manufacturing/packingModel.ts
// and helpers.ts: AUTO posts, MANUAL does not, circular BOMs are refused.

var PACK_UNIT_ALIASES = {
  g: 'G', gram: 'G', grams: 'G',
  kg: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG',
  ml: 'ML', millilitre: 'ML', milliliter: 'ML', millilitres: 'ML', milliliters: 'ML',
  l: 'L', litre: 'L', liter: 'L', litres: 'L', liters: 'L',
  pc: 'PCS', pcs: 'PCS', piece: 'PCS', pieces: 'PCS',
  bag: 'BAG', bags: 'BAG', bottle: 'BOTTLE', bottles: 'BOTTLE',
  box: 'BOX', boxes: 'BOX', carton: 'CARTON', cartons: 'CARTON',
  roll: 'ROLL', rolls: 'ROLL', pack: 'PACKS', packs: 'PACKS', tin: 'TIN', tins: 'TIN'
};

var PACK_UNIT_META = {
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

var PACK_DISCRETE_UNITS = {
  PCS: true, PACKS: true, TIN: true, BAG: true, BOTTLE: true, BOX: true, CARTON: true, ROLL: true
};

function packingText(value) {
  return value === undefined || value === null ? '' : String(value);
}

function packingRound2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function packingNormalizeUnit(unit) {
  var raw = packingText(unit).trim();
  if (!raw) return '';
  return PACK_UNIT_ALIASES[raw.toLowerCase()] || raw.toUpperCase();
}

function packingConsumptionMethod(item) {
  return item && packingText(item.consumptionMethod).trim() === 'MANUAL' ? 'MANUAL' : 'AUTO';
}

function packingIsDiscreteUnit(unit) {
  var code = packingNormalizeUnit(unit);
  return Boolean(code) && PACK_DISCRETE_UNITS[code];
}

function packingPurchaseConversionQty(product) {
  if (!product) return 0;
  if (packingNormalizeUnit(product.unit) === packingNormalizeUnit(product.purchaseUnit || product.unit)) return 1;
  var qty = Number(product.purchaseConversionQty);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

function packingQtyToInventory(qty, fromUnit, product) {
  if (!Number.isFinite(qty) || !product) {
    return { ok: false, reason: 'Cannot convert packing units.' };
  }
  var from = packingNormalizeUnit(fromUnit) || packingNormalizeUnit(product.unit);
  var base = packingNormalizeUnit(product.unit);
  if (!from || !base) {
    return { ok: false, reason: 'Cannot convert packing units.' };
  }
  if (from === base) return { ok: true, qty: qty };
  var fromMeta = PACK_UNIT_META[from];
  var baseMeta = PACK_UNIT_META[base];
  if (fromMeta && baseMeta && fromMeta.family === baseMeta.family && fromMeta.family !== 'pack') {
    return { ok: true, qty: (qty * fromMeta.factor) / baseMeta.factor };
  }
  var purchase = packingNormalizeUnit(product.purchaseUnit || '');
  var conversion = packingPurchaseConversionQty(product);
  if (purchase && from === purchase && conversion > 0 && from !== base) {
    return { ok: true, qty: qty * conversion };
  }
  return { ok: false, reason: 'Cannot convert packing units.' };
}

function packingApplyDiscreteRounding(qty, unit) {
  var rounded = packingRound2(qty);
  if (!packingIsDiscreteUnit(unit)) return rounded;
  var epsilon = 1e-9;
  if (Math.abs(rounded - Math.round(rounded)) < epsilon) return Math.round(rounded);
  return Math.ceil(rounded - epsilon);
}

function packingScaleFactor(outputQty, actualQty) {
  return outputQty > 0 ? actualQty / outputQty : 0;
}

function packingSnapshotItemKey(item) {
  return packingText(item.productId) + '|' + Number(item.qty) + '|' + packingNormalizeUnit(item.unit) + '|' +
    Number(item.wastagePct || 0) + '|' + packingConsumptionMethod(item);
}

function packingBomChanged(snapshot, bom) {
  if (!snapshot || !bom) return true;
  if (snapshot.bomId !== bom.id) return true;
  if (packingText(snapshot.name) !== packingText(bom.name)) return true;
  if (Number(snapshot.outputQty) !== Number(bom.outputQty)) return true;
  if (packingNormalizeUnit(snapshot.outputUnit) !== packingNormalizeUnit(bom.outputUnit)) return true;
  var live = (bom.items || []).map(packingSnapshotItemKey).sort();
  var saved = (snapshot.items || []).map(packingSnapshotItemKey).sort();
  if (live.length !== saved.length) return true;
  for (var i = 0; i < live.length; i += 1) {
    if (live[i] !== saved[i]) return true;
  }
  return false;
}

function packingHasSelfReference(outputProductId, items) {
  var id = packingText(outputProductId);
  for (var i = 0; i < (items || []).length; i += 1) {
    if (packingText(items[i].productId) === id) return true;
  }
  return false;
}

function packingHasCircularBom(boms, outputProductId, snapshotItems) {
  if (snapshotItems && packingHasSelfReference(outputProductId, snapshotItems)) return true;
  var children = {};
  (boms || []).forEach(function (bom) {
    if (packingText(bom.status) !== 'active') return;
    var next = children[bom.productId] || [];
    (bom.items || []).forEach(function (item) {
      if (next.indexOf(item.productId) < 0) next.push(item.productId);
    });
    children[bom.productId] = next;
  });
  var stack = {};
  var seen = {};
  function visit(id) {
    if (stack[id]) return true;
    if (seen[id]) return false;
    stack[id] = true;
    var list = children[id] || [];
    for (var i = 0; i < list.length; i += 1) {
      if (visit(list[i])) return true;
    }
    delete stack[id];
    seen[id] = true;
    return false;
  }
  return visit(outputProductId);
}

function packingQtyOf(inventory, productId, warehouseId) {
  var qty = 0;
  (inventory || []).forEach(function (row) {
    if (row.productId === productId && row.warehouseId === warehouseId) qty = Number(row.qty) || 0;
  });
  return qty;
}

function packingLinesFromSnapshot(snapshot, actualQty, products, inventory, warehouseId) {
  var factor = packingScaleFactor(Number(snapshot.outputQty), Number(actualQty));
  var productMap = {};
  (products || []).forEach(function (product) { productMap[product.id] = product; });
  var conversionError = '';
  var lines = (snapshot.items || []).map(function (item) {
    var product = productMap[item.productId];
    var name = product ? product.name : packingText(item.productName) || 'Unknown';
    var sku = product ? product.sku : packingText(item.sku);
    var inventoryUnit = product ? product.unit : item.unit;
    var onHand = packingQtyOf(inventory, item.productId, warehouseId);
    var baseBomQty = Number(item.qty) * factor;
    var wastageBomQty = baseBomQty * ((Number(item.wastagePct) || 0) / 100);
    var method = packingConsumptionMethod(item);
    function fail(reason) {
      if (!conversionError) conversionError = reason;
      return {
        productId: item.productId,
        name: name,
        sku: sku,
        bomQty: Number(item.qty),
        bomUnit: item.unit,
        baseQty: 0,
        wastagePct: Number(item.wastagePct) || 0,
        wastageQty: 0,
        requiredQty: 0,
        unit: inventoryUnit,
        notes: packingText(item.notes),
        onHand: packingRound2(onHand),
        afterPosting: packingRound2(onHand),
        shortage: 0,
        conversionError: reason,
        consumptionMethod: method
      };
    }
    if (!product) return fail('Component ' + name + ' is missing.');
    var convertedBase = packingQtyToInventory(baseBomQty, item.unit, product);
    if (!convertedBase.ok) return fail(convertedBase.reason);
    var convertedTotal = packingQtyToInventory(baseBomQty + wastageBomQty, item.unit, product);
    if (!convertedTotal.ok) return fail(convertedTotal.reason);
    var baseQty = packingApplyDiscreteRounding(convertedBase.qty, inventoryUnit);
    var requiredQty = packingApplyDiscreteRounding(convertedTotal.qty, inventoryUnit);
    var wastageQty = packingRound2(Math.max(0, requiredQty - baseQty));
    var postsOut = method !== 'MANUAL';
    var shortage = postsOut ? packingRound2(Math.max(0, requiredQty - onHand)) : 0;
    return {
      productId: item.productId,
      name: name,
      sku: sku,
      bomQty: Number(item.qty),
      bomUnit: item.unit,
      baseQty: baseQty,
      wastagePct: Number(item.wastagePct) || 0,
      wastageQty: wastageQty,
      requiredQty: requiredQty,
      unit: inventoryUnit,
      notes: packingText(item.notes),
      onHand: packingRound2(onHand),
      afterPosting: postsOut ? packingRound2(onHand - requiredQty) : packingRound2(onHand),
      shortage: shortage,
      consumptionMethod: method
    };
  });
  var costEstimate = 0;
  lines.forEach(function (line) {
    var product = productMap[line.productId];
    var converted = product ? packingQtyToInventory(line.requiredQty, line.unit, product) : { ok: true, qty: line.requiredQty };
    var qty = converted.ok ? converted.qty : line.requiredQty;
    var conversion = packingPurchaseConversionQty(product);
    var unitCost = 0;
    if (product) {
      if (product.purchaseCost !== undefined && product.purchaseCost !== null && Number.isFinite(Number(product.purchaseCost)) && conversion > 0) {
        unitCost = packingRound2(Number(product.purchaseCost) / conversion);
      } else {
        unitCost = packingRound2(product.costPrice || 0);
      }
    }
    costEstimate += qty * unitCost;
  });
  return {
    ok: !conversionError,
    factor: factor,
    lines: lines,
    conversionError: conversionError || undefined,
    hasShortage: lines.some(function (line) { return line.shortage > 0; }),
    costEstimate: packingRound2(costEstimate)
  };
}

function packingConsumptionsFromPreview(preview) {
  return (preview.lines || []).map(function (line) {
    return {
      productId: line.productId,
      expectedQty: line.requiredQty,
      actualQty: line.consumptionMethod === 'MANUAL' ? 0 : line.requiredQty,
      unit: line.unit,
      notes: line.notes,
      baseQty: line.baseQty,
      wastagePct: line.wastagePct,
      wastageQty: line.wastageQty,
      bomUnit: line.bomUnit
    };
  });
}

function packingValidateQuantities(plannedQty, actualQty, outputUnit) {
  if (!Number.isFinite(plannedQty) || plannedQty <= 0) return 'Enter a planned quantity greater than 0.';
  if (!Number.isFinite(actualQty) || actualQty <= 0) return 'Enter an actual quantity greater than 0.';
  if (actualQty > plannedQty) return 'Actual quantity cannot exceed planned quantity.';
  if (packingIsDiscreteUnit(outputUnit)) {
    if (!Number.isInteger(plannedQty)) return 'Planned quantity must be a whole number for this unit.';
    if (!Number.isInteger(actualQty)) return 'Actual quantity must be a whole number for this unit.';
  }
  return '';
}

function packingCaptureBomSnapshot(bom, products, capturedAt) {
  var productMap = {};
  (products || []).forEach(function (product) { productMap[product.id] = product; });
  return {
    bomId: bom.id,
    name: bom.name,
    outputQty: bom.outputQty,
    outputUnit: bom.outputUnit,
    capturedAt: capturedAt,
    items: (bom.items || []).map(function (item) {
      var product = productMap[item.productId];
      return {
        productId: item.productId,
        productName: product ? product.name : 'Unknown',
        sku: product ? product.sku : '',
        qty: item.qty,
        unit: item.unit,
        wastagePct: item.wastagePct,
        notes: packingText(item.notes),
        consumptionMethod: packingConsumptionMethod(item)
      };
    })
  };
}

function packingBomLinesForQty(bom, plannedQty) {
  var factor = bom.outputQty > 0 ? plannedQty / bom.outputQty : 0;
  return (bom.items || []).map(function (item) {
    var base = Number(item.qty) * factor;
    var expectedQty = packingRound2(base * (1 + (Number(item.wastagePct) || 0) / 100));
    return {
      productId: item.productId,
      expectedQty: expectedQty,
      actualQty: expectedQty,
      unit: item.unit,
      notes: packingText(item.notes),
      consumptionMethod: packingConsumptionMethod(item)
    };
  });
}

function packingAutoConsumptions(bom, consumptions) {
  return (consumptions || []).filter(function (line) {
    if (packingConsumptionMethod(line) === 'MANUAL') return false;
    var item = null;
    ((bom && bom.items) || []).forEach(function (row) {
      if (row.productId === line.productId) item = row;
    });
    return packingConsumptionMethod(item) !== 'MANUAL';
  });
}

function packingQtyToBaseUnit(qty, fromUnit, product) {
  var converted = packingQtyToInventory(qty, fromUnit, product);
  return converted.ok ? converted.qty : null;
}
