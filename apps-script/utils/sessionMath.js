// Daily session math. Matches src/features/manufacturing/sessionPlan.ts,
// helpers.ts sessionComponentIsManual, and materialClosing.ts.
// Display qty + carton qty must equal actual qty. Complete posts once.

function sessionRound2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function sessionText(value) {
  return value === undefined || value === null ? '' : String(value);
}

function sessionDateKey(value) {
  var raw = sessionText(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (typeof businessDate === 'function') return businessDate(raw ? new Date(raw) : new Date());
  return sessionText(raw).slice(0, 10);
}

function sessionIsOperationalToday(session, today) {
  return sessionDateKey(session && session.productionDate) === sessionDateKey(today);
}

function sessionCanEdit(role, status) {
  if (status === 'cancelled') return false;
  if (status === 'completed') return role === 'admin' || role === 'owner';
  return role === 'staff' || role === 'warehouse' || role === 'manager' || role === 'admin' || role === 'owner';
}

function sessionCanRun(role) {
  return role === 'staff' || role === 'warehouse' || role === 'manager' || role === 'admin' || role === 'owner';
}

function sessionCanAmendStatus(status) {
  return status === 'accepted' || status === 'in_progress';
}

function sessionRemainingTarget(item) {
  return Math.max(0, Number(item && item.targetQty) - Number(item && item.actualQty || 0));
}

function sessionDistributionEqualsActual(displayQty, cartonQty, actualQty) {
  return sessionRound2(Number(displayQty || 0) + Number(cartonQty || 0)) === sessionRound2(Number(actualQty || 0));
}

function sessionIsRawStorePickingLine(line) {
  if (!line || line.kind !== 'raw') return false;
  var id = sessionText(line.id);
  var productId = sessionText(line.productId);
  return id === 'raw-' + productId || id.indexOf('raw-' + productId + '-') === 0;
}

function sessionComponentIsManual(boms, sessionItems, productId) {
  var methods = [];
  (sessionItems || []).forEach(function (item) {
    var bom = null;
    (boms || []).forEach(function (row) {
      if (row.id === item.bomId) bom = row;
    });
    if (!bom) {
      (boms || []).forEach(function (row) {
        if (row.productId === item.productId && row.status === 'active') bom = row;
      });
    }
    var line = null;
    ((bom && bom.items) || []).forEach(function (row) {
      if (row.productId === productId) line = row;
    });
    if (line) methods.push(packingConsumptionMethod(line));
  });
  if (!methods.length) return false;
  return methods.every(function (method) { return method === 'MANUAL'; });
}

function sessionGramsPerPack(bom) {
  if (bom && bom.bulkYieldGrams && bom.outputQty > 0) return bom.bulkYieldGrams / bom.outputQty;
  return 0;
}

function sessionBulkRequiredGrams(bom, packs) {
  return sessionRound2(sessionGramsPerPack(bom) * packs);
}

function sessionIsPackagingLine(products, productId, unit) {
  var product = null;
  (products || []).forEach(function (row) {
    if (row.id === productId) product = row;
  });
  return packingNormalizeUnit(unit) === 'PCS' || (product && product.categoryId === 'cat-pack');
}

function sessionAllocateBalanceFifo(balances, productId, requiredG) {
  var available = (balances || []).filter(function (row) {
    return row.productId === productId && row.status === 'available' && Number(row.quantity) > 0;
  }).slice().sort(function (a, b) {
    var dateCmp = sessionText(a.productionDate).localeCompare(sessionText(b.productionDate));
    return dateCmp || sessionText(a.id).localeCompare(sessionText(b.id));
  });
  var need = requiredG;
  var used = [];
  available.forEach(function (row) {
    if (need <= 0) return;
    var take = sessionRound2(Math.min(Number(row.quantity), need));
    if (!(take > 0)) return;
    used.push({
      balanceId: row.id,
      qty: take,
      location: row.location,
      container: row.container,
      date: row.productionDate,
      reference: row.productionReference
    });
    need = sessionRound2(need - take);
  });
  return { used: used, remainingRequired: need };
}

function sessionSuggestPurchasePick(product, bomBaseQty) {
  var need = sessionRound2(Math.max(0, Number.isFinite(bomBaseQty) ? bomBaseQty : 0));
  var baseUnit = packingNormalizeUnit(product && product.unit) || 'KG';
  var purchaseUnit = packingNormalizeUnit(product && (product.purchaseUnit || product.unit)) || baseUnit;
  var conversion = packingPurchaseConversionQty(product);
  if (product && purchaseUnit !== baseUnit && conversion > 0) {
    var purchaseQty = need > 0 ? Math.max(1, Math.ceil(need / conversion - 1e-9)) : 0;
    return {
      purchaseQty: purchaseQty,
      purchaseUnit: purchaseUnit,
      baseQty: sessionRound2(purchaseQty * conversion),
      baseUnit: baseUnit
    };
  }
  return { purchaseQty: need, purchaseUnit: baseUnit, baseQty: need, baseUnit: baseUnit };
}

function sessionBuildPlan(products, boms, balances, session) {
  var requirements = [];
  var rawMap = {};
  (session.items || []).forEach(function (item) {
    var bom = null;
    (boms || []).forEach(function (row) {
      if (row.id === item.bomId) bom = row;
    });
    if (!bom) {
      (boms || []).forEach(function (row) {
        if (row.productId === item.productId && row.status === 'active') bom = row;
      });
    }
    if (!bom) return;
    var bulkRequiredG = sessionBulkRequiredGrams(bom, item.targetQty);
    var allocated = sessionAllocateBalanceFifo(balances, item.productId, bulkRequiredG);
    var balanceUsedG = sessionRound2(allocated.used.reduce(function (sum, row) { return sum + row.qty; }, 0));
    var freshBulkG = allocated.remainingRequired;
    requirements.push({
      productId: item.productId,
      bom: bom,
      targetQty: item.targetQty,
      bulkRequiredG: bulkRequiredG,
      balanceUsed: allocated.used,
      balanceUsedG: balanceUsedG,
      freshBulkG: freshBulkG
    });
    var yieldG = bom.bulkYieldGrams || bulkRequiredG || 1;
    (bom.items || []).forEach(function (line) {
      var packaging = sessionIsPackagingLine(products, line.productId, line.unit);
      var factor = bom.outputQty > 0 ? item.targetQty / bom.outputQty : 0;
      var grossQty = packaging
        ? packingRound2(line.qty * factor * (1 + Number(line.wastagePct || 0) / 100))
        : packingRound2(line.qty * (bulkRequiredG / yieldG) * (1 + Number(line.wastagePct || 0) / 100));
      var qty = packaging
        ? grossQty
        : packingRound2(line.qty * (freshBulkG / yieldG) * (1 + Number(line.wastagePct || 0) / 100));
      if (!rawMap[line.productId]) {
        rawMap[line.productId] = { productId: line.productId, qty: 0, grossQty: 0, unit: line.unit };
      }
      rawMap[line.productId].qty = packingRound2(rawMap[line.productId].qty + qty);
      rawMap[line.productId].grossQty = packingRound2(rawMap[line.productId].grossQty + grossQty);
    });
  });
  var consolidatedRaw = Object.keys(rawMap).map(function (id) {
    return rawMap[id];
  });
  var picking = [];
  requirements.forEach(function (req) {
    var product = null;
    (products || []).forEach(function (row) {
      if (row.id === req.productId) product = row;
    });
    req.balanceUsed.forEach(function (alloc) {
      picking.push({
        id: 'bal-' + req.productId + '-' + alloc.balanceId,
        kind: 'balance',
        productId: req.productId,
        label: (product ? product.name : 'Product') + ' production balance',
        requiredQty: req.bulkRequiredG,
        existingBalanceQty: alloc.qty,
        freshQty: req.freshBulkG,
        qtyToPick: alloc.qty,
        unit: 'g',
        source: alloc.location + ' / ' + alloc.container,
        location: alloc.location,
        container: alloc.container,
        balanceId: alloc.balanceId,
        picked: false
      });
    });
    if (req.freshBulkG > 0) {
      picking.push({
        id: 'fresh-bulk-' + req.productId,
        kind: 'raw',
        productId: req.productId,
        label: 'Fresh ' + (product ? product.name : 'product') + ' to produce',
        requiredQty: req.bulkRequiredG,
        existingBalanceQty: req.balanceUsedG,
        freshQty: req.freshBulkG,
        qtyToPick: req.freshBulkG,
        unit: 'g',
        source: 'From BOM materials in this list (not a store pick of finished goods)',
        location: 'Process room',
        container: '',
        picked: false
      });
    }
  });
  consolidatedRaw.forEach(function (row) {
    var product = null;
    (products || []).forEach(function (item) {
      if (item.id === row.productId) product = item;
    });
    var converted = packingQtyToInventory(row.qty, row.unit, product);
    var plannedBase = converted.ok ? packingRound2(converted.qty) : packingRound2(row.qty);
    var pick = sessionSuggestPurchasePick(product, plannedBase);
    picking.push({
      id: 'raw-' + row.productId,
      kind: 'raw',
      productId: row.productId,
      label: product ? product.name : 'Material',
      requiredQty: plannedBase,
      existingBalanceQty: 0,
      freshQty: plannedBase,
      qtyToPick: pick.purchaseQty,
      unit: pick.purchaseUnit,
      source: 'Raw Material Store',
      location: 'Raw Material Store',
      container: '',
      picked: false
    });
  });
  return { products: requirements, consolidatedRaw: consolidatedRaw, picking: picking };
}

function sessionMergePicking(previous, next) {
  var prevById = {};
  (previous || []).forEach(function (line) { prevById[line.id] = line; });
  var picking = (next || []).map(function (line) {
    var old = prevById[line.id];
    return Object.assign({}, line, {
      picked: old ? Boolean(old.picked) : false,
      previousPickedQty: old && old.picked ? old.qtyToPick : undefined
    });
  });
  var excess = [];
  (previous || []).forEach(function (old) {
    if (!old.picked || sessionText(old.id).indexOf('fresh-bulk-') === 0) return;
    var updated = null;
    picking.forEach(function (line) { if (line.id === old.id) updated = line; });
    var extra = sessionRound2(old.qtyToPick - (updated ? updated.qtyToPick : 0));
    if (extra > 0.001) excess.push({ productId: old.productId, qty: extra, unit: old.unit });
  });
  return { picking: picking, excess: excess };
}

function sessionAllocatedQty(session, product, productId) {
  if (!Array.isArray(session.materialAllocations)) {
    var lines = (session.picking || []).filter(function (line) {
      return line.productId === productId && sessionIsRawStorePickingLine(line);
    });
    if (!lines.length) return null;
    return sessionRound2(lines.reduce(function (sum, line) {
      var converted = packingQtyToInventory(line.qtyToPick, line.unit, product);
      return sum + (converted.ok ? converted.qty : line.qtyToPick);
    }, 0));
  }
  return sessionRound2((session.materialAllocations || []).filter(function (row) {
    return row.productId === productId;
  }).reduce(function (sum, row) { return sum + Number(row.baseQty || 0); }, 0));
}

function sessionPlannedClosingMaterials(products, boms, balances, session) {
  var plan = sessionBuildPlan(products, boms, balances, session);
  return plan.consolidatedRaw.filter(function (row) {
    return row.qty > 0;
  }).map(function (row) {
    var product = null;
    (products || []).forEach(function (item) { if (item.id === row.productId) product = item; });
    var converted = packingQtyToInventory(row.qty, row.unit, product);
    var plannedQty = converted.ok ? packingRound2(converted.qty) : packingRound2(row.qty);
    var allocated = sessionAllocatedQty(session, product, row.productId);
    return {
      productId: row.productId,
      plannedQty: plannedQty,
      availableQty: sessionRound2(allocated == null ? plannedQty : allocated),
      unit: product ? product.unit : row.unit
    };
  });
}

function sessionUsesPurchaseSplit(product) {
  if (!product) return false;
  return packingNormalizeUnit(product.unit) !== packingNormalizeUnit(product.purchaseUnit || product.unit);
}

function sessionPhysicalRemaining(product, fullUnits, looseQty) {
  if (!Number.isFinite(fullUnits) || !Number.isFinite(looseQty)) {
    return { ok: false, reason: 'Enter a valid remaining quantity.' };
  }
  if (fullUnits < 0 || looseQty < 0) {
    return { ok: false, reason: 'Quantity cannot be negative.' };
  }
  if (sessionUsesPurchaseSplit(product)) {
    var conversion = packingPurchaseConversionQty(product);
    if (!(conversion > 0)) return { ok: false, reason: 'Purchase conversion is not valid.' };
    return { ok: true, remaining: sessionRound2(fullUnits * conversion + looseQty) };
  }
  if (fullUnits !== 0) {
    return { ok: false, reason: 'Full purchase units are only used when Purchase Unit differs from Base Unit.' };
  }
  return { ok: true, remaining: sessionRound2(looseQty) };
}

function sessionClosingLineFromInput(product, plannedQty, availableQty, input) {
  var remaining = sessionPhysicalRemaining(product, Number(input.fullUnits), Number(input.looseQty));
  if (!remaining.ok) return remaining;
  if (remaining.remaining > availableQty) {
    return { ok: false, reason: 'Physical remaining cannot exceed material allocated to this production session.' };
  }
  var actualUsedQty = sessionRound2(availableQty - remaining.remaining);
  if (actualUsedQty < 0) return { ok: false, reason: 'Actual used cannot be negative.' };
  var varianceQty = sessionRound2(actualUsedQty - plannedQty);
  var variancePercent = plannedQty === 0
    ? (actualUsedQty === 0 ? 0 : 100)
    : sessionRound2((varianceQty / Math.abs(plannedQty)) * 100);
  return {
    ok: true,
    line: {
      productId: product.id,
      plannedQty: sessionRound2(plannedQty),
      availableQty: sessionRound2(availableQty),
      expectedRemainingQty: sessionRound2(availableQty - plannedQty),
      remainingQty: remaining.remaining,
      actualUsedQty: actualUsedQty,
      varianceQty: varianceQty,
      variancePercent: variancePercent,
      fullUnits: sessionUsesPurchaseSplit(product) ? Number(input.fullUnits) : undefined,
      looseQty: Number(input.looseQty)
    }
  };
}

function sessionBuildMaterialClosing(products, boms, balances, session, inputs) {
  var drafts = sessionPlannedClosingMaterials(products, boms, balances, session);
  var lines = [];
  for (var i = 0; i < drafts.length; i += 1) {
    var draft = drafts[i];
    var product = null;
    (products || []).forEach(function (row) { if (row.id === draft.productId) product = row; });
    if (!product) return { ok: false, reason: 'Material is missing from Product Master.' };
    var input = null;
    (inputs || []).forEach(function (row) { if (row.productId === draft.productId) input = row; });
    if (!input) return { ok: false, reason: 'Enter remaining quantity for ' + product.name + '.' };
    var built = sessionClosingLineFromInput(product, draft.plannedQty, draft.availableQty, input);
    if (!built.ok) return { ok: false, reason: product.name + ': ' + built.reason };
    lines.push(built.line);
  }
  return { ok: true, lines: lines };
}

function sessionIsSignificantVariance(line) {
  return Math.abs(Number(line && line.variancePercent)) > 10;
}

function sessionNextReference(sessions, productionDate) {
  var stamp = sessionDateKey(productionDate).replace(/-/g, '');
  var max = 0;
  (sessions || []).forEach(function (row) {
    if (sessionDateKey(row.productionDate) !== sessionDateKey(productionDate)) return;
    var match = sessionText(row.reference).match(/^PROD-\d+-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return 'PROD-' + stamp + '-' + String(max + 1).padStart(3, '0');
}
