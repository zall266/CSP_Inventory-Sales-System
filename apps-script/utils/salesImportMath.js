// Ported from src/features/salesImport mapping/review/reconcile for Apps Script V8.

(function (root) {
function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
function salesComponentsOf(product) {
  var rows = product && product.salesComponents ? product.salesComponents : [];
  var merged = {};
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    var productId = String(row && row.productId ? row.productId : '').trim();
    var qty = Number(row && row.qty);
    if (!productId || !Number.isFinite(qty) || !(qty > 0)) continue;
    merged[productId] = round2((merged[productId] || 0) + qty);
  }
  return Object.keys(merged).map(function (id) {
    return { productId: id, qty: merged[id] };
  });
}
function normalizeTextKey(name, variation) {
    const norm = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    return `${norm(name)}|${norm(variation !== null && variation !== void 0 ? variation : '')}`;
}
function mappingIdentity(line) {
    var _a, _b, _c;
    const sku = (_a = line.externalSku) === null || _a === void 0 ? void 0 : _a.trim();
    if (sku)
        return { keyType: 'sku', key: sku };
    const parent = (_b = line.parentSku) === null || _b === void 0 ? void 0 : _b.trim();
    if (parent && !((_c = line.variationText) === null || _c === void 0 ? void 0 : _c.trim()))
        return { keyType: 'sku', key: parent };
    return { keyType: 'text', key: normalizeTextKey(line.externalProductName, line.variationText) };
}
function mappingKeyLabel(identity) {
    return identity.keyType === 'sku' ? `sku:${identity.key}` : `text:${identity.key}`;
}
function externalLabel(line) {
    var _a, _b;
    const sku = (_a = line.externalSku) === null || _a === void 0 ? void 0 : _a.trim();
    const variation = (_b = line.variationText) === null || _b === void 0 ? void 0 : _b.trim();
    if (sku && variation)
        return `${sku} · ${variation}`;
    if (sku)
        return sku;
    if (variation)
        return variation;
    return line.externalProductName;
}
function tokens(value) {
    return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}
function suggestProduct(line, products) {
    var _a, _b;
    const source = tokens(`${(_a = line.variationText) !== null && _a !== void 0 ? _a : ''} ${(_b = line.externalSku) !== null && _b !== void 0 ? _b : ''}`);
    const fallback = source.length ? source : tokens(line.externalProductName);
    if (!fallback.length)
        return undefined;
    let best;
    for (const product of products) {
        if (product.status !== 'active')
            continue;
        const nameTokens = tokens(product.name);
        if (!nameTokens.length)
            continue;
        const overlap = fallback.filter((token) => nameTokens.includes(token)).length;
        const score = overlap / fallback.length;
        if (overlap < 1 || score < 0.5)
            continue;
        if (!best || score > best.score)
            best = { id: product.id, score };
    }
    return best === null || best === void 0 ? void 0 : best.id;
}
function mappingIsActive(mapping) {
    return mapping.active !== false;
}
function mappingSourceTexts(mapping, lines, orders, batches) {
    var _a, _b;
    const batchIds = new Set(batches.filter((batch) => batch.platform === mapping.platform && batch.accountId === mapping.accountId).map((batch) => batch.id));
    const orderIds = new Set(orders.filter((order) => batchIds.has(order.batchId)).map((order) => order.id));
    const texts = [];
    for (const line of lines) {
        if (!orderIds.has(line.orderId))
            continue;
        const identity = mappingIdentity(line);
        if (identity.keyType !== mapping.keyType || identity.key !== mapping.key)
            continue;
        const name = (_a = line.externalProductName) === null || _a === void 0 ? void 0 : _a.trim();
        const variation = (_b = line.variationText) === null || _b === void 0 ? void 0 : _b.trim();
        if (name && !texts.includes(name))
            texts.push(name);
        if (variation && !texts.includes(variation))
            texts.push(variation);
    }
    return texts;
}
function filterSalesImportMappings(input) {
    const query = input.search.trim().toLowerCase();
    return input.mappings.filter((mapping) => {
        if (input.platform && mapping.platform !== input.platform)
            return false;
        if (input.accountId && mapping.accountId !== input.accountId)
            return false;
        const active = mappingIsActive(mapping);
        if (input.status === 'active' && !active)
            return false;
        if (input.status === 'inactive' && active)
            return false;
        if (!query)
            return true;
        const product = input.products.find((item) => item.id === mapping.productId);
        const source = mappingSourceTexts(mapping, input.lines, input.orders, input.batches);
        const haystack = [mapping.key, product === null || product === void 0 ? void 0 : product.name, product === null || product === void 0 ? void 0 : product.sku, ...source].join(' ').toLowerCase();
        return haystack.includes(query);
    });
}
function resolveLineProduct(line, platform, accountId, mappings, products) {
    const identity = mappingIdentity(line);
    const saved = mappings.find((row) => row.platform === platform && row.accountId === accountId && row.keyType === identity.keyType && row.key === identity.key && mappingIsActive(row));
    if (saved) {
        const savedProduct = products.find((product) => product.id === saved.productId && product.status === 'active');
        if (savedProduct)
            return { productId: savedProduct.id, identity, exactSku: false };
        return { productId: undefined, identity, exactSku: false };
    }
    if (identity.keyType === 'sku') {
        const exact = products.find((product) => product.status === 'active' && product.sku.trim() === identity.key);
        if (exact)
            return { productId: exact.id, identity, exactSku: true };
        return { productId: undefined, identity, exactSku: false, suggestionId: suggestProduct(line, products) };
    }
    return { productId: undefined, identity, exactSku: false, suggestionId: suggestProduct(line, products) };
}

const SALES_IMPORT_WAREHOUSE_ID = 'wh-main';
function saleReference(platform, accountName, externalOrderId) {
    return `${platform.trim().toUpperCase()}:${accountName.trim()}:${externalOrderId.trim()}`;
}
function takenOrderIds(input) {
    var _a;
    const taken = new Set();
    for (const order of input.orders) {
        if (order.status !== 'confirmed' || !order.saleId)
            continue;
        if (input.exceptBatchId && order.batchId === input.exceptBatchId)
            continue;
        const batch = input.batches.find((item) => item.id === order.batchId);
        if (!batch || batch.platform !== input.platform || batch.accountId !== input.accountId)
            continue;
        const sale = input.sales.find((item) => item.id === order.saleId);
        if (!sale || sale.status === 'voided')
            continue;
        taken.add(order.externalOrderId);
    }
    const prefix = `${input.platform.toUpperCase()}:${input.accountName.trim()}:`;
    for (const sale of input.sales) {
        if (sale.status === 'voided' || !((_a = sale.reference) === null || _a === void 0 ? void 0 : _a.startsWith(prefix)))
            continue;
        taken.add(sale.reference.slice(prefix.length));
    }
    return taken;
}
function materializeOrders(input) {
    var _a, _b, _c, _d;
    const buckets = new Map();
    const sharedIds = new Set();
    for (const file of input.files) {
        if (file.parseError)
            continue;
        for (const message of (_a = file.customerMessages) !== null && _a !== void 0 ? _a : []) {
            const bucket = (_b = buckets.get(message.orderId)) !== null && _b !== void 0 ? _b : { fileId: file.id, lines: [], unallocated: false };
            bucket.message = message.message;
            buckets.set(message.orderId, bucket);
        }
        for (const parsed of (_c = file.parsedLines) !== null && _c !== void 0 ? _c : []) {
            if (!parsed.orderIds.length)
                continue;
            const shared = parsed.orderIds.length > 1;
            if (shared)
                for (const id of parsed.orderIds)
                    sharedIds.add(id);
            for (const orderId of parsed.orderIds) {
                const bucket = (_d = buckets.get(orderId)) !== null && _d !== void 0 ? _d : { fileId: file.id, lines: [], unallocated: false };
                if (!bucket.fileId)
                    bucket.fileId = file.id;
                const resolved = resolveLineProduct(parsed, input.platform, input.accountId, input.mappings, input.products);
                bucket.lines.push(draftLine(parsed, shared, resolved.productId, resolved.suggestionId));
                buckets.set(orderId, bucket);
            }
        }
    }
    const drafts = [];
    for (const [externalOrderId, bucket] of buckets) {
        if (!bucket.lines.length)
            continue;
        const unallocated = sharedIds.has(externalOrderId) || bucket.lines.some((line) => line.unallocated);
        const lines = bucket.lines.map((line) => (unallocated ? { ...line, unallocated: true } : line));
        drafts.push({
            externalOrderId,
            customerMessage: bucket.message,
            fileId: bucket.fileId,
            lines,
            status: draftStatus(externalOrderId, lines, input.takenOrderIds),
        });
    }
    return drafts.sort((a, b) => a.externalOrderId.localeCompare(b.externalOrderId));
}
function draftLine(parsed, shared, productId, suggestionId) {
    return {
        externalProductName: parsed.externalProductName,
        variationText: parsed.variationText,
        parentSku: parsed.parentSku,
        externalSku: parsed.externalSku,
        quantity: parsed.quantity,
        unallocated: shared,
        sharedOrderCount: shared ? parsed.orderIds.length : undefined,
        mappedProductId: productId,
        suggestionId,
    };
}
function draftStatus(externalOrderId, lines, taken) {
    if (taken.has(externalOrderId))
        return 'duplicate';
    if (!lines.length || lines.some((line) => !(line.quantity > 0)))
        return 'error';
    if (lines.some((line) => line.unallocated))
        return 'unallocated';
    if (lines.some((line) => line.quantityReview))
        return 'error';
    if (lines.some((line) => !line.mappedProductId))
        return 'unmapped';
    return 'new';
}
function accountIssues(accountName, files, acknowledged) {
    var _a, _b, _c;
    const expected = accountName.trim().toLowerCase();
    const mismatchNames = new Set();
    let unknown = false;
    for (const file of files) {
        if (file.parseError)
            continue;
        if (file.role === 'awb') {
            if (file.identityReliable && ((_a = file.detectedUsername) === null || _a === void 0 ? void 0 : _a.trim()) && file.detectedUsername.trim().toLowerCase() !== expected) {
                mismatchNames.add(file.detectedUsername.trim());
            }
            continue;
        }
        if (file.role !== 'picking' || !((_b = file.parsedLines) === null || _b === void 0 ? void 0 : _b.length))
            continue;
        if (file.identityReliable && ((_c = file.detectedUsername) === null || _c === void 0 ? void 0 : _c.trim())) {
            if (file.detectedUsername.trim().toLowerCase() !== expected)
                mismatchNames.add(file.detectedUsername.trim());
        }
        else
            unknown = true;
    }
    return {
        mismatch: mismatchNames.size > 0,
        mismatchNames: [...mismatchNames],
        needsAcknowledgement: unknown && !acknowledged,
    };
}
function liveOrderStatus(order, lines, takenOrderIds) {
    if (order.status === 'confirmed' && order.saleId)
        return 'confirmed';
    const own = lines.filter((line) => line.orderId === order.id);
    return draftStatus(order.externalOrderId, own.map((line) => ({
        externalProductName: line.externalProductName,
        variationText: line.variationText,
        parentSku: line.parentSku,
        externalSku: line.externalSku,
        quantity: line.quantity,
        unallocated: Boolean(line.unallocated),
        quantityReview: Boolean(line.quantityReview),
        sharedOrderCount: line.sharedOrderCount,
        mappedProductId: line.mappedProductId,
    })), takenOrderIds);
}
function deriveBatchStatus(orders, fileCount) {
    if (!fileCount)
        return 'draft';
    const confirmed = orders.filter((order) => order.status === 'confirmed');
    const unresolved = orders.filter((order) => order.status !== 'confirmed' && order.status !== 'duplicate');
    if (confirmed.length && unresolved.length)
        return 'partial';
    if (confirmed.length && !unresolved.length)
        return 'confirmed';
    return 'ready';
}
function requiredStock(lines, products) {
    var _a, _b;
    const required = new Map();
    for (const line of lines) {
        if (line.unallocated || !line.mappedProductId || !(line.quantity > 0))
            continue;
        const product = products.find((item) => item.id === line.mappedProductId);
        if (!product)
            continue;
        const components = salesComponentsOf(product);
        if (components.length) {
            for (const component of components) {
                required.set(component.productId, round2(((_a = required.get(component.productId)) !== null && _a !== void 0 ? _a : 0) + round2(line.quantity * component.qty)));
            }
        }
        else {
            required.set(product.id, round2(((_b = required.get(product.id)) !== null && _b !== void 0 ? _b : 0) + line.quantity));
        }
    }
    return required;
}
function assessSalesImport(input) {
    var _a, _b;
    const files = input.files.filter((file) => file.batchId === input.batch.id);
    const pickingFiles = files.filter((file) => file.role !== 'awb');
    const orders = input.orders.filter((order) => order.batchId === input.batch.id);
    const account = accountIssues(input.account.name, files, input.batch.accountAcknowledged);
    const statuses = orders.map((order) => ({ order, status: liveOrderStatus(order, input.lines, input.takenOrderIds) }));
    const ready = statuses.filter((row) => row.status === 'new').map((row) => row.order);
    const readyLines = input.lines.filter((line) => ready.some((order) => order.id === line.orderId) && !line.unallocated);
    const shortages = [];
    if (!input.allowNegativeStock) {
        for (const [productId, qty] of requiredStock(readyLines, input.products)) {
            const available = input.availableQty(productId);
            if (qty > available) {
                const product = input.products.find((item) => item.id === productId);
                shortages.push({ productId, name: (_a = product === null || product === void 0 ? void 0 : product.name) !== null && _a !== void 0 ? _a : 'Item', required: qty, available });
            }
        }
    }
    const blockers = [];
    if (account.mismatch)
        blockers.push(`Account mismatch. File username ${account.mismatchNames.join(', ')} does not match ${input.account.name}.`);
    if (account.needsAcknowledgement)
        blockers.push('Acknowledge that these files belong to the selected platform and account.');
    if (shortages.length)
        blockers.push('Insufficient stock. Nothing will be posted until the full confirm set is available.');
    const issues = statuses
        .filter((row) => row.status !== 'new' && row.status !== 'confirmed')
        .map((row) => ({
        orderId: row.order.id,
        externalOrderId: row.order.externalOrderId,
        label: issueLabel(row.status, input.lines.filter((line) => line.orderId === row.order.id)),
    }));
    for (const file of files) {
        if (file.parseError)
            issues.push({ orderId: file.id, externalOrderId: file.fileName, label: `Parse error: ${file.parseError}` });
        for (const warning of (_b = file.warnings) !== null && _b !== void 0 ? _b : [])
            issues.push({ orderId: file.id, externalOrderId: file.fileName, label: warning });
    }
    for (const shortage of shortages) {
        issues.push({ orderId: shortage.productId, externalOrderId: shortage.name, label: `Insufficient stock. ${shortage.name} has ${shortage.available} available. Required: ${shortage.required}.` });
    }
    const canConfirm = blockers.length === 0 && ready.length > 0;
    return {
        fileCount: pickingFiles.length,
        orderCount: orders.length,
        newOrders: statuses.filter((row) => row.status === 'new').length,
        duplicates: statuses.filter((row) => row.status === 'duplicate').length,
        unmapped: statuses.filter((row) => row.status === 'unmapped').length,
        unallocated: statuses.filter((row) => row.status === 'unallocated').length,
        errors: statuses.filter((row) => row.status === 'error').length + files.filter((file) => file.parseError).length,
        mismatch: account.mismatch,
        mismatchNames: account.mismatchNames,
        needsAcknowledgement: account.needsAcknowledgement,
        readyOrderIds: canConfirm ? ready.map((order) => order.id) : [],
        shortages,
        blockers,
        canConfirm,
        issues,
    };
}
function issueLabel(status, lines) {
    if (status === 'duplicate')
        return 'Duplicate';
    if (status === 'unallocated') {
        const shared = lines.find((line) => { var _a; return ((_a = line.sharedOrderCount) !== null && _a !== void 0 ? _a : 0) > 1; });
        if (shared)
            return `Unallocated quantity. Qty ${shared.quantity} is shared by ${shared.sharedOrderCount} orders.`;
        return 'Unallocated quantity';
    }
    if (status === 'unmapped') {
        const missing = lines.find((line) => !line.mappedProductId && !line.unallocated);
        return missing ? `Unmapped: ${externalLabel(missing)}` : 'Unmapped';
    }
    if (status === 'error') {
        if (lines.some((line) => line.quantityReview))
            return 'Quantity review. Picking and AWB quantities differ.';
        return 'Validation error';
    }
    return status;
}
function salesImportSummary(input) {
    var _a, _b, _c, _d, _e, _f, _g;
    const postOrderIds = input.assessment.canConfirm ? input.assessment.readyOrderIds : [];
    const postIds = new Set(postOrderIds);
    const statuses = input.orders.map((order) => ({ order, status: liveOrderStatus(order, input.lines, input.takenOrderIds) }));
    const seenImported = new Set();
    let importedQty = 0;
    for (const row of statuses) {
        if (row.status === 'confirmed')
            continue;
        for (const line of input.lines.filter((item) => item.orderId === row.order.id)) {
            const shared = Boolean(line.unallocated) && ((_a = line.sharedOrderCount) !== null && _a !== void 0 ? _a : 0) > 1;
            const key = shared
                ? `shared:${(_b = line.externalSku) !== null && _b !== void 0 ? _b : ''}:${(_c = line.parentSku) !== null && _c !== void 0 ? _c : ''}:${line.externalProductName}:${(_d = line.variationText) !== null && _d !== void 0 ? _d : ''}:${line.quantity}:${line.sharedOrderCount}`
                : line.id;
            if (seenImported.has(key))
                continue;
            seenImported.add(key);
            importedQty = round2(importedQty + line.quantity);
        }
    }
    const postLines = input.lines.filter((line) => postIds.has(line.orderId) && !line.unallocated && line.mappedProductId && line.quantity > 0);
    const products = new Map();
    let postQty = 0;
    for (const line of postLines) {
        const productId = line.mappedProductId;
        const product = input.products.find((item) => item.id === productId);
        const current = (_e = products.get(productId)) !== null && _e !== void 0 ? _e : { productId, name: (product === null || product === void 0 ? void 0 : product.name) || ((_f = line.mappedProductSnapshot) === null || _f === void 0 ? void 0 : _f.productName) || 'Product', qty: 0 };
        current.qty = round2(current.qty + line.quantity);
        products.set(productId, current);
        postQty = round2(postQty + line.quantity);
    }
    const reasons = new Map();
    for (const row of statuses) {
        if (row.status === 'confirmed' || postIds.has(row.order.id))
            continue;
        const label = attentionReason(row.status, input.assessment);
        reasons.set(label, ((_g = reasons.get(label)) !== null && _g !== void 0 ? _g : 0) + 1);
    }
    const pending = input.orders.filter((order) => !input.shipments.some((shipment) => shipment.externalOrderId === order.externalOrderId)).length;
    return {
        orders: input.assessment.orderCount,
        ready: postOrderIds.length,
        attention: statuses.filter((row) => row.status !== 'confirmed' && !postIds.has(row.order.id)).length,
        confirmed: statuses.filter((row) => row.status === 'confirmed').length,
        duplicates: input.assessment.duplicates,
        unmapped: input.assessment.unmapped,
        unallocated: input.assessment.unallocated,
        errors: statuses.filter((row) => row.status === 'error').length,
        importedQty,
        postQty,
        heldQty: round2(importedQty - postQty),
        products: [...products.values()],
        reasons: [...reasons.entries()].map(([label, count]) => ({ label, count })),
        mappingOk: input.assessment.unmapped === 0,
        inventoryOk: input.assessment.shortages.length === 0,
        awb: {
            matched: input.shipments.filter((shipment) => shipment.linkStatus === 'matched').length,
            pending,
            unmatched: input.shipments.filter((shipment) => shipment.linkStatus === 'unmatched').length,
            review: input.shipments.filter((shipment) => shipment.linkStatus === 'review').length,
        },
        postOrderIds,
    };
}
function accountKey(line) {
    var _a, _b, _c, _d;
    const shared = Boolean(line.unallocated) && ((_a = line.sharedOrderCount) !== null && _a !== void 0 ? _a : 0) > 1;
    if (!shared)
        return `line:${line.id}`;
    return `shared:${(_b = line.externalSku) !== null && _b !== void 0 ? _b : ''}:${(_c = line.parentSku) !== null && _c !== void 0 ? _c : ''}:${line.externalProductName}:${(_d = line.variationText) !== null && _d !== void 0 ? _d : ''}:${line.quantity}:${line.sharedOrderCount}`;
}
function productKey(line) {
    var _a, _b;
    if (line.mappedProductId)
        return `mapped:${line.mappedProductId}`;
    return `unmapped:${((_a = line.externalSku) !== null && _a !== void 0 ? _a : '').trim()}|${line.externalProductName}|${(_b = line.variationText) !== null && _b !== void 0 ? _b : ''}`;
}
function stableProductOrder(rows) {
    const rank = { 'needs-mapping': 0, 'action-required': 1, ready: 2 };
    return [...rows.filter((row) => rank[row.displayStatus] === 0), ...rows.filter((row) => rank[row.displayStatus] === 1), ...rows.filter((row) => rank[row.displayStatus] === 2)];
}
function salesImportLinesForBatch(batchId, orders, lines) {
    const owner = new Map(orders.map((order) => [order.id, order.batchId]));
    return lines.filter((line) => {
        const ownerBatch = owner.get(line.orderId);
        return ownerBatch === undefined || ownerBatch === batchId;
    });
}
function productName(line, products) {
    var _a, _b, _c;
    if (line.mappedProductId) {
        return ((_a = products.find((item) => item.id === line.mappedProductId)) === null || _a === void 0 ? void 0 : _a.name) || ((_b = line.mappedProductSnapshot) === null || _b === void 0 ? void 0 : _b.productName) || 'Product';
    }
    const variation = (_c = line.variationText) === null || _c === void 0 ? void 0 : _c.trim();
    if (variation && variation.toLowerCase() !== line.externalProductName.trim().toLowerCase())
        return `${line.externalProductName} — ${variation}`;
    return line.externalProductName || 'Unmapped product';
}
function rememberLineIssue(row, lines) {
    var _a;
    for (const line of lines) {
        if (line.unallocated && !row.reasons.includes('Shared quantity is not ready to post.'))
            row.reasons.push('Shared quantity is not ready to post.');
        if (line.quantityReview && !row.reasons.includes('Quantity mismatch')) {
            row.reasons.push('Quantity mismatch');
            const picking = (_a = line.pickingQuantity) !== null && _a !== void 0 ? _a : line.quantity;
            const awb = line.quantitySource === 'awb' ? line.quantity : undefined;
            if (!row.details.some((detail) => detail.startsWith('Picking:'))) {
                row.details.push(`Picking: ${picking}`);
                if (awb !== undefined) {
                    row.details.push(`AWB: ${awb}`);
                    row.details.push(`Difference: ${round2(awb - picking)}`);
                }
            }
        }
    }
}
function assignDisplayStatus(rows, assessment, products) {
    const shortIds = new Set(assessment.shortages.map((row) => row.productId));
    for (const row of rows) {
        if (!row.mapped) {
            row.displayStatus = 'needs-mapping';
            row.reasons = row.reasons.filter((reason) => reason === 'Shared quantity is not ready to post.' || reason === 'Quantity mismatch');
            continue;
        }
        const productId = row.key.startsWith('mapped:') ? row.key.slice('mapped:'.length) : '';
        const product = products.find((item) => item.id === productId);
        const componentShort = product ? salesComponentsOf(product).filter((component) => shortIds.has(component.productId)) : [];
        const ownShort = assessment.shortages.find((item) => item.productId === productId);
        const reasons = row.reasons.filter((reason) => reason === 'Shared quantity is not ready to post.' || reason === 'Quantity mismatch');
        if (ownShort) {
            reasons.push('Stock shortage');
            row.details.push(`Required: ${ownShort.required}`, `Available: ${ownShort.available}`, `Short: ${round2(Math.max(0, ownShort.required - ownShort.available))}`);
        }
        for (const component of componentShort) {
            const shortage = assessment.shortages.find((item) => item.productId === component.productId);
            if (!shortage || reasons.includes('Stock shortage'))
                continue;
            reasons.push('Stock shortage');
            row.details.push(`${shortage.name} required ${shortage.required}, available ${shortage.available}`);
        }
        if (!reasons.length && row.willPost > 0 && row.needReview > 0)
            reasons.push('Not all of this quantity can be imported yet.');
        row.reasons = reasons;
        row.displayStatus = reasons.length ? 'action-required' : 'ready';
        if (row.displayStatus === 'ready')
            row.reasons = [];
    }
}
function salesImportProductReview(input) {
    var _a, _b, _c;
    const postIds = new Set(input.assessment.canConfirm ? input.assessment.readyOrderIds : []);
    const orders = new Map(input.orders.map((order) => [order.id, order]));
    const statusOf = new Map(input.orders.map((order) => [order.id, liveOrderStatus(order, input.lines, input.takenOrderIds)]));
    const groups = new Map();
    for (const line of input.lines) {
        if (!(line.quantity > 0))
            continue;
        const order = orders.get(line.orderId);
        const bucket = !order
            ? 'unaccounted'
            : statusOf.get(order.id) === 'confirmed'
                ? 'confirmed'
                : postIds.has(order.id)
                    ? 'post'
                    : 'review';
        const key = accountKey(line);
        const group = (_a = groups.get(key)) !== null && _a !== void 0 ? _a : { qty: line.quantity, buckets: new Set(), lines: [] };
        group.buckets.add(bucket);
        group.lines.push(line);
        if (group.qty !== line.quantity)
            group.buckets.add('unaccounted');
        groups.set(key, group);
    }
    const totals = { post: 0, review: 0, confirmed: 0, unaccounted: 0, imported: 0 };
    const products = new Map();
    for (const group of groups.values()) {
        totals.imported = round2(totals.imported + group.qty);
        const bucket = group.buckets.size === 1 ? [...group.buckets][0] : 'unaccounted';
        totals[bucket] = round2(totals[bucket] + group.qty);
        const line = (_b = group.lines.find((item) => item.mappedProductId)) !== null && _b !== void 0 ? _b : group.lines[0];
        const key = productKey(line);
        const identity = mappingIdentity(line);
        const row = (_c = products.get(key)) !== null && _c !== void 0 ? _c : {
            key,
            name: productName(line, input.products),
            mapped: Boolean(line.mappedProductId),
            imported: 0,
            willPost: 0,
            needReview: 0,
            confirmed: 0,
            displayStatus: line.mappedProductId ? 'ready' : 'needs-mapping',
            reasons: [],
            details: [],
            keyType: line.mappedProductId ? undefined : identity.keyType,
            mapKey: line.mappedProductId ? undefined : identity.key,
        };
        row.imported = round2(row.imported + group.qty);
        if (bucket === 'post')
            row.willPost = round2(row.willPost + group.qty);
        if (bucket === 'review')
            row.needReview = round2(row.needReview + group.qty);
        if (bucket === 'confirmed')
            row.confirmed = round2(row.confirmed + group.qty);
        if (!row.mapped && !line.mappedProductId && !row.mapKey) {
            row.keyType = identity.keyType;
            row.mapKey = identity.key;
        }
        rememberLineIssue(row, group.lines);
        products.set(key, row);
    }
    assignDisplayStatus([...products.values()], input.assessment, input.products);
    const unaccounted = round2(totals.imported - totals.post - totals.review - totals.confirmed);
    const attentionOrders = (status) => input.orders.filter((order) => statusOf.get(order.id) === status);
    const unitsFor = (orderIds) => {
        const seen = new Set();
        let qty = 0;
        for (const line of input.lines) {
            if (!orderIds.has(line.orderId) || !(line.quantity > 0))
                continue;
            const key = accountKey(line);
            if (seen.has(key))
                continue;
            seen.add(key);
            qty = round2(qty + line.quantity);
        }
        return qty;
    };
    const quantityOrders = attentionOrders('error').filter((order) => input.lines.some((line) => line.orderId === order.id && line.quantityReview));
    const otherOrders = attentionOrders('error').filter((order) => !quantityOrders.some((item) => item.id === order.id));
    const detailFor = (list, kind) => {
        var _a;
        const rows = new Map();
        const seen = new Set();
        for (const order of list) {
            for (const line of input.lines.filter((item) => item.orderId === order.id)) {
                if (kind === 'quantity' && !line.quantityReview)
                    continue;
                if (kind === 'unallocated' && !line.unallocated)
                    continue;
                const key = `${productKey(line)}|${accountKey(line)}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                const current = (_a = rows.get(productKey(line))) !== null && _a !== void 0 ? _a : { name: productName(line, input.products), qty: 0 };
                current.qty = round2(current.qty + line.quantity);
                rows.set(productKey(line), current);
            }
        }
        return [...rows.values()].map((row) => kind === 'unallocated'
            ? `${row.name} — ${row.qty} imported / 0 allocated / ${row.qty} unallocated`
            : `${row.name} — ${row.qty} in quantity review`);
    };
    const quantityIds = new Set(quantityOrders.map((order) => order.id));
    const unallocatedIds = new Set(attentionOrders('unallocated').map((order) => order.id));
    const unmappedIds = new Set(attentionOrders('unmapped').map((order) => order.id));
    const duplicateIds = new Set(attentionOrders('duplicate').map((order) => order.id));
    const otherIds = new Set(otherOrders.map((order) => order.id));
    const attention = [
        { id: 'quantity', label: 'Quantity Review', orders: quantityOrders.length, units: unitsFor(quantityIds), ok: quantityOrders.length === 0, details: detailFor(quantityOrders, 'quantity') },
        { id: 'unallocated', label: 'Unallocated Quantity', orders: unallocatedIds.size, units: unitsFor(unallocatedIds), ok: unallocatedIds.size === 0, details: detailFor(attentionOrders('unallocated'), 'unallocated') },
        { id: 'unmapped', label: 'Unmapped', orders: unmappedIds.size, units: unitsFor(unmappedIds), ok: unmappedIds.size === 0, details: [] },
        { id: 'duplicate', label: 'Duplicate', orders: duplicateIds.size, units: unitsFor(duplicateIds), ok: duplicateIds.size === 0, details: [] },
        { id: 'other', label: 'Other Errors', orders: otherIds.size, units: unitsFor(otherIds), ok: otherIds.size === 0 && input.assessment.blockers.length === 0, details: input.assessment.blockers },
        { id: 'inventory', label: 'Inventory', orders: input.assessment.shortages.length, units: input.assessment.shortages.reduce((sum, row) => round2(sum + Math.max(0, row.required - row.available)), 0), ok: input.assessment.shortages.length === 0, details: input.assessment.shortages.map((row) => `${row.name} — required ${row.required}, available ${row.available}`) },
    ];
    return {
        imported: totals.imported,
        willPost: totals.post,
        needReview: totals.review,
        alreadyConfirmed: totals.confirmed,
        unaccounted,
        ok: unaccounted === 0,
        products: stableProductOrder([...products.values()]),
        attention,
    };
}
function salesImportActions(input) {
    var _a, _b;
    const statusOf = new Map(input.orders.map((order) => [order.id, liveOrderStatus(order, input.lines, input.takenOrderIds)]));
    const withStatus = (status) => input.orders.filter((order) => statusOf.get(order.id) === status);
    const seenQty = (lines) => {
        const seen = new Set();
        let qty = 0;
        for (const line of lines) {
            if (!(line.quantity > 0))
                continue;
            const key = accountKey(line);
            if (seen.has(key))
                continue;
            seen.add(key);
            qty = round2(qty + line.quantity);
        }
        return qty;
    };
    const orderRef = (list) => list.length === 1 ? list[0].externalOrderId : `${list.length} orders`;
    const categories = [];
    const unmappedOrders = withStatus('unmapped');
    const mapGroups = new Map();
    for (const order of unmappedOrders) {
        for (const line of input.lines.filter((item) => item.orderId === order.id && !item.mappedProductId && !item.unallocated)) {
            const identity = mappingIdentity(line);
            const id = `${identity.keyType}:${identity.key}`;
            const group = (_a = mapGroups.get(id)) !== null && _a !== void 0 ? _a : {
                row: { id, product: externalLabel(line), units: 0, orders: 0, orderRef: '', keyType: identity.keyType, mapKey: identity.key },
                orders: [],
                lines: [],
            };
            if (!group.orders.some((item) => item.id === order.id))
                group.orders.push(order);
            group.lines.push(line);
            mapGroups.set(id, group);
        }
    }
    const mapRows = [...mapGroups.values()].map((group) => ({
        ...group.row,
        units: seenQty(group.lines),
        orders: group.orders.length,
        orderRef: orderRef(group.orders),
    }));
    if (mapRows.length) {
        categories.push({
            id: 'map',
            title: 'Map Products',
            hint: 'Products still need to be mapped',
            count: mapRows.length,
            units: seenQty(mapRows.flatMap(() => [])),
            orderIds: unmappedOrders.map((order) => order.id),
            rows: mapRows,
        });
        categories[categories.length - 1].units = seenQty(input.lines.filter((line) => unmappedOrders.some((order) => order.id === line.orderId) && !line.mappedProductId && !line.unallocated));
    }
    const quantityOrders = withStatus('error').filter((order) => input.lines.some((line) => line.orderId === order.id && line.quantityReview));
    const quantityRows = [];
    for (const order of quantityOrders) {
        for (const line of input.lines.filter((item) => item.orderId === order.id && item.quantityReview)) {
            const picking = (_b = line.pickingQuantity) !== null && _b !== void 0 ? _b : line.quantity;
            const awb = line.quantitySource === 'awb' ? line.quantity : undefined;
            quantityRows.push({
                id: line.id,
                product: line.mappedProductId ? productName(line, input.products) : externalLabel(line),
                units: line.quantity,
                orders: 1,
                orderRef: order.externalOrderId,
                picking,
                awb,
                difference: awb === undefined ? undefined : round2(awb - picking),
            });
        }
    }
    if (quantityRows.length) {
        categories.push({
            id: 'quantity',
            title: 'Review Quantity',
            hint: 'Picking and AWB quantities disagree',
            count: quantityOrders.length,
            units: seenQty(input.lines.filter((line) => quantityOrders.some((order) => order.id === line.orderId) && line.quantityReview)),
            orderIds: quantityOrders.map((order) => order.id),
            rows: quantityRows,
        });
    }
    const unallocatedOrders = withStatus('unallocated');
    const unallocatedRows = [];
    const seenUnallocated = new Set();
    for (const order of unallocatedOrders) {
        for (const line of input.lines.filter((item) => item.orderId === order.id && item.unallocated)) {
            const key = `${order.id}:${accountKey(line)}`;
            if (seenUnallocated.has(key))
                continue;
            seenUnallocated.add(key);
            unallocatedRows.push({
                id: `${order.id}:${line.id}`,
                product: line.mappedProductId ? productName(line, input.products) : externalLabel(line),
                units: line.quantity,
                orders: 1,
                orderRef: order.externalOrderId,
                imported: line.quantity,
                allocated: 0,
                unallocatedQty: line.quantity,
            });
        }
    }
    if (unallocatedRows.length) {
        categories.push({
            id: 'unallocated',
            title: 'Review Unallocated',
            hint: 'This shared quantity is not allocated yet',
            count: unallocatedOrders.length,
            units: seenQty(input.lines.filter((line) => unallocatedOrders.some((order) => order.id === line.orderId) && line.unallocated)),
            orderIds: unallocatedOrders.map((order) => order.id),
            rows: unallocatedRows,
        });
    }
    if (input.assessment.shortages.length) {
        categories.push({
            id: 'stock',
            title: 'Check Stock',
            hint: 'Ready orders stay unposted until stock is sufficient',
            count: input.assessment.shortages.length,
            units: input.assessment.shortages.reduce((sum, row) => round2(sum + Math.max(0, row.required - row.available)), 0),
            orderIds: [],
            rows: input.assessment.shortages.map((row) => ({
                id: row.productId,
                product: row.name,
                units: round2(Math.max(0, row.required - row.available)),
                orders: 0,
                orderRef: '',
                required: row.required,
                available: row.available,
                short: round2(Math.max(0, row.required - row.available)),
            })),
        });
    }
    const duplicateOrders = withStatus('duplicate');
    if (duplicateOrders.length) {
        categories.push({
            id: 'duplicate',
            title: 'Review Duplicates',
            hint: 'These orders were already imported',
            count: duplicateOrders.length,
            units: seenQty(input.lines.filter((line) => duplicateOrders.some((order) => order.id === line.orderId))),
            orderIds: duplicateOrders.map((order) => order.id),
            rows: duplicateOrders.map((order) => ({
                id: order.id,
                product: order.externalOrderId,
                units: seenQty(input.lines.filter((line) => line.orderId === order.id)),
                orders: 1,
                orderRef: order.externalOrderId,
                status: order.saleId ? 'Already confirmed' : 'Already imported',
            })),
        });
    }
    const otherOrders = withStatus('error').filter((order) => !quantityOrders.some((item) => item.id === order.id));
    const otherNotes = [
        ...input.assessment.blockers,
        ...otherOrders.map((order) => `${order.externalOrderId}: needs a check`),
    ];
    if (otherNotes.length) {
        categories.push({
            id: 'other',
            title: input.assessment.blockers.length ? 'Account or file check' : 'Needs a check',
            hint: 'These checks apply before any orders can be posted',
            count: otherNotes.length,
            units: 0,
            orderIds: otherOrders.map((order) => order.id),
            rows: otherNotes.map((note, index) => ({ id: `other-${index}`, product: note, units: 0, orders: 0, orderRef: '' })),
        });
    }
    const rank = { other: input.assessment.blockers.length ? 0 : 5, map: 1, quantity: 2, unallocated: 3, stock: 4, duplicate: 6 };
    categories.sort((a, b) => rank[a.id] - rank[b.id]);
    const orderIds = new Set(categories.flatMap((category) => category.orderIds));
    return {
        issues: categories.reduce((sum, category) => sum + category.count, 0),
        orders: orderIds.size,
        categories,
    };
}
function attentionReason(status, assessment) {
    if (status === 'duplicate')
        return 'Duplicate';
    if (status === 'unallocated')
        return 'Unallocated quantity';
    if (status === 'unmapped')
        return 'Unmapped product';
    if (status === 'error')
        return 'Quantity review';
    if (assessment.mismatch)
        return 'Account mismatch';
    if (assessment.needsAcknowledgement)
        return 'Acknowledgement required';
    if (assessment.shortages.length)
        return 'Inventory';
    return 'Needs attention';
}
function batchStatusLabel(status) {
    if (status === 'draft')
        return 'Draft';
    if (status === 'ready')
        return 'Ready to Review';
    if (status === 'partial')
        return 'Partially Confirmed';
    return 'Confirmed';
}

(function () {
const GENERIC = new Set(['ready', 'stock', 'serbuk', 'premium', 'crispy', 'series', 'air', 'balang', 'pelbagai', 'perisa', 'viral', 'pack', 'minuman']);
function tokens(value) {
    return value
        .toLowerCase()
        .replace(/ready\s+stock/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((token) => token.length > 2 && !GENERIC.has(token));
}
function overlap(left, right) {
    if (!left.length || !right.length)
        return 0;
    let shared = 0;
    for (const token of left)
        if (right.includes(token))
            shared += 1;
    return shared / Math.min(left.length, right.length);
}
function sameProduct(line, packing) {
    var _a, _b, _c, _d, _e, _f, _g;
    const leftSku = (_a = line.externalSku) === null || _a === void 0 ? void 0 : _a.trim();
    const rightSku = (_b = packing.externalSku) === null || _b === void 0 ? void 0 : _b.trim();
    if (leftSku && rightSku)
        return leftSku === rightSku;
    if (leftSku && ((_c = packing.variationText) === null || _c === void 0 ? void 0 : _c.includes(leftSku)))
        return true;
    const leftVariation = tokens((_d = line.variationText) !== null && _d !== void 0 ? _d : '');
    const rightVariation = tokens((_e = packing.variationText) !== null && _e !== void 0 ? _e : '');
    if (leftVariation.length && rightVariation.length)
        return overlap(leftVariation, rightVariation) >= 0.6;
    const left = tokens(`${line.externalProductName} ${(_f = line.variationText) !== null && _f !== void 0 ? _f : ''}`);
    const right = tokens(`${packing.externalProductName} ${(_g = packing.variationText) !== null && _g !== void 0 ? _g : ''}`);
    return overlap(left, right) >= 0.6;
}
function awbQuantityFor(line, orderId, shipments) {
    const matches = shipments
        .filter((shipment) => shipment.externalOrderId === orderId)
        .flatMap((shipment) => shipment.packingLines)
        .filter((packing) => sameProduct(line, packing));
    if (!matches.length)
        return undefined;
    return matches.reduce((sum, packing) => sum + packing.quantity, 0);
}
function reconcileAwbLines(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const openIds = new Set(input.orders.filter((order) => !(order.status === 'confirmed' && order.saleId)).map((order) => order.id));
    const orderNo = new Map(input.orders.map((order) => [order.id, order.externalOrderId]));
    const lines = input.lines.map((line) => ({ ...line }));
    const reviewOrderIds = new Set();
    const groups = new Map();
    for (const line of lines) {
        if (!openIds.has(line.orderId) || !line.unallocated || ((_a = line.sharedOrderCount) !== null && _a !== void 0 ? _a : 0) < 2)
            continue;
        const key = `${(_b = line.externalSku) !== null && _b !== void 0 ? _b : ''}|${(_c = line.parentSku) !== null && _c !== void 0 ? _c : ''}|${tokens(line.externalProductName).join('-')}|${tokens((_d = line.variationText) !== null && _d !== void 0 ? _d : '').join('-')}|${line.quantity}|${line.sharedOrderCount}`;
        const group = (_e = groups.get(key)) !== null && _e !== void 0 ? _e : [];
        group.push(line);
        groups.set(key, group);
    }
    for (const group of groups.values()) {
        const expected = (_g = (_f = group[0]) === null || _f === void 0 ? void 0 : _f.sharedOrderCount) !== null && _g !== void 0 ? _g : 0;
        const sharedQty = (_j = (_h = group[0]) === null || _h === void 0 ? void 0 : _h.quantity) !== null && _j !== void 0 ? _j : 0;
        if (group.length !== expected)
            continue;
        const allocated = group.map((line) => {
            var _a;
            const orderId = (_a = orderNo.get(line.orderId)) !== null && _a !== void 0 ? _a : '';
            return { line, qty: awbQuantityFor(line, orderId, input.shipments) };
        });
        const sum = allocated.reduce((total, row) => { var _a; return total + ((_a = row.qty) !== null && _a !== void 0 ? _a : 0); }, 0);
        const comparable = allocated.every((row) => row.qty !== undefined && row.qty > 0);
        if (!comparable || sum !== sharedQty) {
            if (comparable && sum !== sharedQty) {
                for (const row of allocated) {
                    row.line.quantityReview = true;
                    reviewOrderIds.add((_k = orderNo.get(row.line.orderId)) !== null && _k !== void 0 ? _k : '');
                }
            }
            continue;
        }
        for (const row of allocated) {
            row.line.pickingQuantity = sharedQty;
            row.line.quantity = (_l = row.qty) !== null && _l !== void 0 ? _l : row.line.quantity;
            row.line.quantitySource = 'awb';
            row.line.unallocated = undefined;
        }
    }
    for (const line of lines) {
        if (!openIds.has(line.orderId) || line.quantitySource === 'awb' || line.quantityReview)
            continue;
        const orderId = (_m = orderNo.get(line.orderId)) !== null && _m !== void 0 ? _m : '';
        const awbQty = awbQuantityFor(line, orderId, input.shipments);
        if (awbQty === undefined)
            continue;
        const shared = ((_o = line.sharedOrderCount) !== null && _o !== void 0 ? _o : 0) >= 2;
        if (line.unallocated && shared)
            continue;
        if (awbQty === line.quantity) {
            if (line.unallocated) {
                line.pickingQuantity = line.quantity;
                line.quantitySource = 'awb';
                line.unallocated = undefined;
            }
            continue;
        }
        line.quantityReview = true;
        reviewOrderIds.add(orderId);
    }
    return { lines, reviewOrderIds };
}
function shipmentLinkStatus(input) {
    if (!input.knownOrderIds.has(input.externalOrderId))
        return 'unmatched';
    const distinct = new Set(input.siblingTrackings);
    if (distinct.size > 1)
        return 'review';
    if (input.reviewOrderIds.has(input.externalOrderId))
        return 'review';
    return 'matched';
}

  root.normalizeTextKey = normalizeTextKey;
  root.mappingIdentity = mappingIdentity;
  root.mappingKeyLabel = mappingKeyLabel;
  root.externalLabel = externalLabel;
  root.suggestProduct = suggestProduct;
  root.mappingIsActive = mappingIsActive;
  root.mappingSourceTexts = mappingSourceTexts;
  root.filterSalesImportMappings = filterSalesImportMappings;
  root.resolveLineProduct = resolveLineProduct;
  root.SALES_IMPORT_WAREHOUSE_ID = SALES_IMPORT_WAREHOUSE_ID;
  root.saleReference = saleReference;
  root.takenOrderIds = takenOrderIds;
  root.materializeOrders = materializeOrders;
  root.accountIssues = accountIssues;
  root.liveOrderStatus = liveOrderStatus;
  root.deriveBatchStatus = deriveBatchStatus;
  root.requiredStock = requiredStock;
  root.assessSalesImport = assessSalesImport;
  root.salesImportSummary = salesImportSummary;
  root.salesImportLinesForBatch = salesImportLinesForBatch;
  root.salesImportProductReview = salesImportProductReview;
  root.salesImportActions = salesImportActions;
  root.batchStatusLabel = batchStatusLabel;
  root.awbQuantityFor = awbQuantityFor;
  root.reconcileAwbLines = reconcileAwbLines;
  root.shipmentLinkStatus = shipmentLinkStatus;
})();
})(typeof globalThis !== 'undefined' ? globalThis : this);
