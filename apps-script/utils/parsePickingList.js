// Ported from src/features/salesImport/parsePickingList.ts for Apps Script V8.

var parsePickingList = (function () {
const SHOPEE_ORDER = /26\d{4}[A-Z0-9]{8}/g;
const LONG_ORDER = /\d{18}/g;
function clean(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function rowsOf(items) {
    const pages = [...new Set(items.map((item) => item.page))].sort((a, b) => a - b);
    const rows = [];
    for (const page of pages) {
        const pageItems = items.filter((item) => item.page === page && item.text.trim());
        const grouped = [];
        for (const item of pageItems) {
            const found = grouped.find((row) => Math.abs(row.y - item.y) <= 4);
            if (found)
                found.items.push(item);
            else
                grouped.push({ y: item.y, items: [item] });
        }
        grouped.sort((a, b) => b.y - a.y);
        for (const row of grouped)
            rows.push([...row.items].sort((a, b) => a.x - b.x));
    }
    return rows;
}
function rowText(row) {
    return clean(row.map((item) => item.text).join(' '));
}
function nearest(x, anchors) {
    var _a;
    let best = anchors[0];
    let distance = Infinity;
    for (const anchor of anchors) {
        const next = Math.abs(anchor.x - x);
        if (next < distance) {
            best = anchor;
            distance = next;
        }
    }
    return (_a = best === null || best === void 0 ? void 0 : best.key) !== null && _a !== void 0 ? _a : '';
}
function reliableUsername(value) {
    const name = value.trim();
    if (!name || /[*@\s]/.test(name))
        return false;
    return /^[A-Za-z0-9._-]{3,64}$/.test(name);
}
function identityFrom(rows) {
    for (const row of rows) {
        const text = rowText(row);
        const username = text.match(/Username:\s*(\S+)/i);
        if (username)
            return { detectedUsername: username[1], identityReliable: reliableUsername(username[1]) };
        const user = text.match(/^User:\s*(.+)$/i);
        if (user) {
            const detectedUsername = user[1].trim();
            return { detectedUsername, identityReliable: reliableUsername(detectedUsername) };
        }
    }
    return { detectedUsername: undefined, identityReliable: false };
}
function detectLayout(rows) {
    const text = rows.map(rowText).join('\n');
    if (/Picking List/i.test(text) && /Seller SKU/i.test(text) && /Order quantity/i.test(text))
        return 'numeric-picklist';
    if (/Picklist/i.test(text) && /Parent SKU/i.test(text) && /Username:/i.test(text))
        return 'shopee-picklist';
    return 'unknown';
}
function shopeeAnchors(header) {
    const anchors = [];
    for (const item of header) {
        const text = item.text.trim();
        if (text === '#')
            anchors.push({ key: 'index', x: item.x });
        else if (/Parent SKU/i.test(text))
            anchors.push({ key: 'parent', x: item.x });
        else if (text === 'Name')
            anchors.push({ key: 'name', x: item.x });
        else if (text === 'SKU')
            anchors.push({ key: 'sku', x: item.x });
        else if (/Variation/i.test(text))
            anchors.push({ key: 'variation', x: item.x });
        else if (text === 'Qty')
            anchors.push({ key: 'qty', x: item.x });
        else if (/Order ID/i.test(text))
            anchors.push({ key: 'order', x: item.x });
        else if (/Location/i.test(text))
            anchors.push({ key: 'location', x: item.x });
    }
    return anchors;
}
function orderIdsIn(text) {
    return [...text.toUpperCase().matchAll(SHOPEE_ORDER)].map((match) => match[0]);
}
function ignoreOrderToken(text) {
    const value = text.trim().toLowerCase();
    return value === 'package' || value === 'package 1' || value === '1';
}
function readShopeeRow(row, anchors) {
    const part = { name: [], variation: [], orderIds: [] };
    let qty;
    const variationBits = [];
    for (const item of row) {
        const column = nearest(item.x, anchors);
        const text = clean(item.text);
        if (!text || text.toLowerCase() === 'image')
            continue;
        if (column === 'index')
            continue;
        if (column === 'name') {
            part.name.push(text);
            continue;
        }
        if (column === 'parent' && /^[A-Za-z0-9][A-Za-z0-9-]{2,}$/.test(text)) {
            part.parentSku = text;
            continue;
        }
        if (column === 'sku' && /^[A-Za-z0-9][A-Za-z0-9-]{2,}$/.test(text)) {
            part.sku = text;
            continue;
        }
        if (column === 'qty' && /^\d{1,5}$/.test(text)) {
            qty = Number(text);
            continue;
        }
        if (column === 'order' || column === 'location') {
            if (ignoreOrderToken(text))
                continue;
            part.orderIds.push(...orderIdsIn(text));
            continue;
        }
        if (column === 'variation')
            variationBits.push(text);
    }
    let variation = clean(variationBits.join(' '));
    if (qty == null && variation) {
        const trailing = variation.match(/^(.*\D)\s+(\d{1,5})$/);
        if (trailing) {
            variation = clean(trailing[1]);
            qty = Number(trailing[2]);
        }
    }
    if (variation)
        part.variation.push(variation);
    if (qty != null && qty > 0)
        part.qty = qty;
    part.orderIds = [...new Set(part.orderIds)];
    return part;
}
function linesFromShopee(rows, anchors) {
    var _a;
    const blocks = [];
    let block = null;
    for (const row of rows) {
        if (/Parent SKU/i.test(rowText(row)) && /Qty/.test(rowText(row)))
            continue;
        const indexItem = row.find((item) => nearest(item.x, anchors) === 'index' && /^\d{1,3}$/.test(item.text.trim()));
        if (indexItem) {
            block = [row];
            blocks.push(block);
        }
        else if (block)
            block.push(row);
    }
    const lines = [];
    for (const group of blocks) {
        const nameParts = [];
        let parentSku = '';
        const segs = [];
        let seg = null;
        let carryOrderId = '';
        const push = () => {
            if (seg && seg.qty && seg.qty > 0) {
                if (!seg.orderIds.length && carryOrderId)
                    seg.orderIds = [carryOrderId];
                segs.push(seg);
                carryOrderId = seg.orderIds.length === 1 ? seg.orderIds[0] : '';
            }
            seg = null;
        };
        for (const row of group) {
            const part = readShopeeRow(row, anchors);
            nameParts.push(...part.name);
            if (part.parentSku)
                parentSku = part.parentSku;
            const payload = part.qty != null || part.variation.length > 0 || Boolean(part.sku) || part.orderIds.length > 0;
            if (!payload)
                continue;
            if (part.qty != null && (seg == null || seg.qty != null)) {
                push();
                seg = { variation: [...part.variation], sku: part.sku, qty: part.qty, orderIds: [...part.orderIds] };
                continue;
            }
            if (!seg) {
                seg = { variation: [...part.variation], sku: part.sku, qty: part.qty, orderIds: [...part.orderIds] };
                continue;
            }
            seg.variation.push(...part.variation);
            if (part.sku && !seg.sku)
                seg.sku = part.sku;
            if (part.qty != null && seg.qty == null)
                seg.qty = part.qty;
            for (const id of part.orderIds)
                if (!seg.orderIds.includes(id))
                    seg.orderIds.push(id);
        }
        push();
        const externalProductName = clean(nameParts.join(' '));
        for (const item of segs) {
            lines.push({
                externalProductName,
                variationText: clean(item.variation.join(' ')) || undefined,
                parentSku: parentSku || undefined,
                externalSku: item.sku || undefined,
                quantity: (_a = item.qty) !== null && _a !== void 0 ? _a : 0,
                orderIds: item.orderIds,
            });
        }
    }
    return lines;
}
function numericAnchors(header) {
    const anchors = [];
    for (const item of header) {
        const text = item.text.trim();
        if (text === 'No')
            anchors.push({ key: 'index', x: item.x });
        else if (/Product name/i.test(text))
            anchors.push({ key: 'name', x: item.x });
        else if (text === 'SKU')
            anchors.push({ key: 'sku', x: item.x });
        else if (/Seller SKU/i.test(text))
            anchors.push({ key: 'seller', x: item.x });
        else if (text === 'Qty')
            anchors.push({ key: 'qty', x: item.x });
        else if (/Order ID/i.test(text))
            anchors.push({ key: 'order', x: item.x });
    }
    return anchors;
}
function clusterZone(items) {
    const sorted = [...items].sort((a, b) => a.x - b.x);
    const groups = [];
    for (const item of sorted) {
        const last = groups[groups.length - 1];
        const prev = last === null || last === void 0 ? void 0 : last[last.length - 1];
        if (!last || !prev || item.x - prev.x > 45)
            groups.push([item]);
        else
            last.push(item);
    }
    return groups.map((group) => clean(group.map((item) => item.text).join(' '))).filter(Boolean);
}
function linesFromNumeric(rows, anchors) {
    var _a, _b, _c, _d, _e, _f, _g;
    const skuX = (_b = (_a = anchors.find((anchor) => anchor.key === 'sku')) === null || _a === void 0 ? void 0 : _a.x) !== null && _b !== void 0 ? _b : 260;
    const qtyX = (_d = (_c = anchors.find((anchor) => anchor.key === 'qty')) === null || _c === void 0 ? void 0 : _c.x) !== null && _d !== void 0 ? _d : 400;
    const messages = [];
    const items = [];
    let nameParts = [];
    let segs = [];
    const close = () => {
        const name = clean(nameParts.join(' '));
        for (const seg of segs) {
            if (!(seg.quantity > 0))
                continue;
            items.push({ name, variation: seg.variation, sku: seg.sku, quantity: seg.quantity, orderIds: seg.orderIds });
        }
        nameParts = [];
        segs = [];
    };
    let messageRows = [];
    let inMessage = false;
    for (const row of rows) {
        const text = rowText(row);
        if (/^Order ID:/i.test(text) || /^Customer message:/i.test(text)) {
            inMessage = true;
            messageRows.push(row);
            continue;
        }
        if (inMessage) {
            messageRows.push(row);
            continue;
        }
        const index = row.find((item) => nearest(item.x, anchors) === 'index' && /^\d{1,3}$/.test(item.text.trim()));
        const name = clean(row.filter((item) => item.x < skuX - 8 && nearest(item.x, anchors) !== 'index').map((item) => item.text).join(' '));
        const zone = clusterZone(row.filter((item) => item.x >= skuX - 8 && item.x < qtyX - 12));
        let variation = '';
        let sku = '';
        if (zone.length >= 2) {
            const left = zone[0];
            const right = clean(zone.slice(1).join(' '));
            if (/^\d{4,}$/.test(left))
                sku = left;
            else if (left)
                nameParts.push(left);
            variation = right;
        }
        else if (zone.length === 1) {
            if (/^\d{4,}$/.test(zone[0]))
                sku = zone[0];
            else
                variation = zone[0];
        }
        const qtyItem = row.find((item) => nearest(item.x, anchors) === 'qty' && /^\d{1,5}$/.test(item.text.trim()));
        const qty = qtyItem ? Number(qtyItem.text.trim()) : undefined;
        const orderIds = [...new Set(row.flatMap((item) => [...item.text.matchAll(LONG_ORDER)].map((match) => match[0])))];
        if (index) {
            close();
            if (name)
                nameParts.push(name);
        }
        else if (name)
            nameParts.push(name);
        if (qty != null && qty > 0) {
            segs.push({ variation: variation || undefined, sku: sku || undefined, quantity: qty, orderIds });
        }
        else if (variation && segs.length) {
            const last = segs[segs.length - 1];
            last.variation = clean(`${(_e = last.variation) !== null && _e !== void 0 ? _e : ''} ${variation}`);
            if (sku && !last.sku)
                last.sku = sku;
            for (const id of orderIds)
                if (!last.orderIds.includes(id))
                    last.orderIds.push(id);
        }
    }
    close();
    if (messageRows.length) {
        const blob = messageRows.map(rowText).join(' ');
        const orderId = (_g = (_f = blob.match(/Order ID:\s*(\d{16,20})/i)) === null || _f === void 0 ? void 0 : _f[1]) !== null && _g !== void 0 ? _g : '';
        const message = clean(blob.replace(/^.*?Customer message:\s*/i, ''));
        if (orderId && message)
            messages.push({ orderId, message });
    }
    return {
        lines: items.map((item) => ({
            externalProductName: item.name,
            variationText: item.variation,
            externalSku: item.sku,
            quantity: item.quantity,
            orderIds: item.orderIds,
        })),
        customerMessages: messages,
    };
}
function warningsFor(lines) {
    return lines
        .filter((line) => !line.orderIds.length)
        .map((line) => {
        var _a, _b;
        const label = clean(`${line.externalProductName} ${(_a = line.variationText) !== null && _a !== void 0 ? _a : ''} ${(_b = line.externalSku) !== null && _b !== void 0 ? _b : ''}`);
        return `${label} × ${line.quantity} has no Order ID`;
    });
}
function parsePickingList(items) {
    const rows = rowsOf(items);
    if (!rows.length) {
        return { layout: 'unknown', identityReliable: false, lines: [], customerMessages: [], warnings: [], error: 'This PDF has no readable text.' };
    }
    const layout = detectLayout(rows);
    const identity = identityFrom(rows);
    if (layout === 'unknown') {
        return {
            layout,
            ...identity,
            lines: [],
            customerMessages: [],
            warnings: [],
            error: 'Unrecognised picking list layout. Sales Import only reads supported picking lists.',
        };
    }
    if (layout === 'shopee-picklist') {
        const header = rows.find((row) => /Parent SKU/i.test(rowText(row)) && /\bQty\b/.test(rowText(row)) && /Order ID/i.test(rowText(row)));
        const anchors = header ? shopeeAnchors(header) : [];
        if (!header || !anchors.some((anchor) => anchor.key === 'qty') || !anchors.some((anchor) => anchor.key === 'order')) {
            return { layout, ...identity, lines: [], customerMessages: [], warnings: [], error: 'Picking list header was not found.' };
        }
        const body = rows.slice(rows.indexOf(header) + 1);
        const lines = linesFromShopee(body, anchors);
        if (!lines.length)
            return { layout, ...identity, lines: [], customerMessages: [], warnings: [], error: 'No picking rows were found.' };
        return { layout, ...identity, lines, customerMessages: [], warnings: warningsFor(lines) };
    }
    const header = rows.find((row) => /Seller SKU/i.test(rowText(row)) && /\bQty\b/.test(rowText(row)) && /Order ID/i.test(rowText(row)));
    const anchors = header ? numericAnchors(header) : [];
    if (!header || anchors.length < 4) {
        return { layout, ...identity, lines: [], customerMessages: [], warnings: [], error: 'Picking list header was not found.' };
    }
    const body = rows.slice(rows.indexOf(header) + 1);
    const parsed = linesFromNumeric(body, anchors);
    if (!parsed.lines.length)
        return { layout, ...identity, lines: [], customerMessages: [], warnings: [], error: 'No picking rows were found.' };
    return { layout, ...identity, lines: parsed.lines, customerMessages: parsed.customerMessages, warnings: warningsFor(parsed.lines) };
}

  return parsePickingList;
})();
