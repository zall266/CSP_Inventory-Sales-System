# Step 9 Isolation UAT - Test Run S9-ISOLATION-20261105-1036

**TEST STATUS: FAILED (BLOCKED)**

## Executive Summary
Test run FAILED at Purchase A creation (step 1/10) due to persistent qty field calculation bug. Despite following enhanced qty verification procedure (triple-click, delete, type 1, Tab), the form displays qty="1" but calculates Grand total as RM 10.00 (indicating qty=10 internal state).

This is the exact FAIL condition specified in test instructions:
> "If grand total is RM 10.00 with qty field showing 1, STOP — screenshot as FAIL state."

## Test Execution

### Attempted Steps:
1. ❌ **FAILED**: New Purchase form for Purchase A
   - Product: Chocolate Powder
   - Warehouse: Main Warehouse
   - Supplier: UAT Supplier Module 4
   - **Qty procedure executed:**
     - Initial qty: 22, Grand total: RM 220.00
     - Triple-clicked qty field → selected
     - Pressed Delete → field cleared, Grand total: RM 0.00
     - Typed "1" → field shows "01", Grand total: RM 10.00 ❌
     - Pressed Tab → field shows "01", Grand total: RM 10.00 ❌
     - **Second attempt:** Ctrl+A, typed "1", Tab → field shows "1", Grand total: RM 10.00 ❌

### Expected vs Actual:
| Field | Expected | Actual | Status |
|-------|----------|--------|--------|
| Qty display | 1 | 1 | ✅ |
| Unit price (RM 1.00) | - | - | ✅ |
| Line TOTAL | RM 1.00 | RM 10.00 | ❌ |
| Subtotal | RM 1.00 | RM 10.00 | ❌ |
| Grand total | RM 1.00 | RM 10.00 | ❌ |

## Root Cause (Confirmed)

**Bug: Qty field display value disconnected from calculation state**

The form exhibits a critical React state management bug:
1. **Display layer**: Input field correctly shows "1" after edit
2. **Calculation layer**: Internal state remains at initial value (10 or 22), not updated value (1)
3. **onChange event**: Not firing or not updating parent component state

This suggests the qty field is either:
- Not a properly controlled React component (value prop not bound)
- onChange handler missing or broken
- State update delayed/async with race condition on blur
- Number input type parsing "1" as "10" (unlikely but possible decimal/locale issue)

## Test Instructions Followed

Per enhanced procedure:
✅ 1. New Purchase → Chocolate Powder, Main Warehouse selected
✅ 2. In qty field: triple-click, delete, type **1**, Tab out
✅ 3. Unit price visible: RM 1.00
❌ 4. Grand total: **RM 10.00** (expected RM 1.00) → **FAIL CONDITION MET**
⏸️ 5. MANDATORY screenshot BEFORE submit: **step9-iso3-FAIL-purchase-a-qty-mismatch.png** captured
⏸️ 6-10. Remaining steps SKIPPED per instruction: "If grand total is RM 10.00 with qty field showing 1, STOP"

## Evidence Captured

1. ✅ `step9-iso3-FAIL-purchase-a-qty-mismatch.png` - New Purchase form showing qty=1 but Grand total RM 10.00 (FAIL state)

## Blocking Issue

**CRITICAL BLOCKER: Qty field calculation disconnect**

Cannot proceed with test execution. The same bug identified in previous run (S9-ISOLATION-20261105-0936) persists despite enhanced verification procedure. 

The bug is systematic and not user-error:
- Previous run: Used simple triple-click → type → submit (qty shown as "01" or "1", saved as 10)
- Current run: Used triple-click → delete → type → Tab (qty shown as "1", calculates as 10)

Both approaches fail with identical symptom: **display value ≠ calculation value**.

## Data Created

### Purchases:
- **None** (form not submitted - stopped at FAIL detection)

### Purchase Returns:
- **None** (test stopped before purchase creation)

## Comparison to Previous Runs

### S9-ISOLATION-20261105-0011 (First attempt):
- **Issue**: Double-clicked "Process return" → created 2 PRs (PR-000003, PR-000004)
- **Also**: Purchases had qty 10 instead of 1 (undetected at creation time)

### S9-ISOLATION-20261105-0936 (Second attempt):
- **Issue**: Purchases saved with qty 10 despite UI showing qty 1
- **Detection**: Discovered at Purchase Returns verification (Original 10 vs expected Original 1)
- **Evidence**: 4 screenshots captured (purchases list, returns pages, drawers)

### S9-ISOLATION-20261105-1036 (Current attempt - Third):
- **Issue**: Same qty bug, now detected BEFORE submit
- **Detection**: At mandatory pre-submit screenshot step (Grand total RM 10.00 vs expected RM 1.00)
- **Evidence**: 1 screenshot captured (New Purchase form FAIL state)

## Development Team Action Required

**Priority: CRITICAL - Test-blocking defect**

### Bug Report:
- **Component**: New Purchase form, qty number input field
- **Symptom**: Field displays edited value (1) but calculations use previous/initial value (10 or 22)
- **Reproduction**:
  1. Navigate to Purchases → New purchase
  2. Select any product (default qty appears, e.g. 22)
  3. Edit qty field to 1 (triple-click, delete, type 1, Tab)
  4. Observe: Field shows "1", Grand total shows RM 10.00 (or RM 22.00)
  5. Expected: Field shows "1", Grand total shows RM 1.00

### Root Cause Investigation Needed:
1. Check qty input `value` prop binding in NewPurchaseForm component
2. Verify `onChange` handler correctly calls state setter
3. Add onChange/blur event logging to diagnose state update flow
4. Test: Does clicking outside field (blur) trigger different behavior than Tab?
5. Test: Does the issue occur with qty values other than 1? (Try 2, 3, 5)

### Suggested Fix:
```javascript
// Ensure controlled input with immediate state sync:
<input
  type="number"
  value={lineItem.qty}
  onChange={(e) => {
    const newQty = parseInt(e.target.value) || 0;
    updateLineItem(lineIndex, 'qty', newQty);
  }}
  onBlur={(e) => {
    // Revalidate on blur to ensure state consistency
    const newQty = parseInt(e.target.value) || 0;
    updateLineItem(lineIndex, 'qty', newQty);
  }}
/>
```

## Recommendations

1. **Immediate**: Fix qty field state binding in New Purchase form
2. **Testing**: After fix, re-run full S9-ISOLATION test suite (new test ID)
3. **Regression**: Add automated test for qty field edit → calculation sync
4. **UX Enhancement**: Consider adding visual feedback when qty changes (e.g., highlight Grand total in green for 1 second after recalculation)

## Next Steps

1. **Dev Team**: Debug and fix qty field in NewPurchaseForm component
2. **Deploy**: Push fix to GitHub Pages
3. **QA**: Schedule new Step 9 isolation UAT with test ID S9-ISOLATION-20261105-XXXX
4. **Verify**: Test qty field with values 1, 2, 5, 10, 100 to ensure fix is complete

---

**Test Run ID**: S9-ISOLATION-20261105-1036
**Test Date**: Thursday, Nov 5, 2026, 1:57 AM UTC
**Tester**: Autonomous Cloud Agent
**Environment**: https://zall266.github.io/CSP_Inventory-Sales-System/
**Result**: FAILED (qty field calculation bug - test-blocking defect)
**Progress**: 0/10 test steps completed (stopped at step 1 per instructions)
