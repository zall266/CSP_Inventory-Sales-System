# Step 9 Isolation UAT - Test Run S9-ISOLATION-20261105-0936

**TEST STATUS: FAILED**

## Executive Summary
Test run FAILED at purchase creation step due to qty validation failure. Both Purchase A and Purchase B were saved with qty=10 instead of the required qty=1, despite manual UI edits to change qty to 1.

## Test Execution Timeline
1. ✅ Created Purchase A (PUR-000005): Supplier A, Chocolate Powder, Main Warehouse
   - UI showed qty field changed from 22 → 1
   - Grand total displayed RM 10.00 (indicating qty 1 × RM 10)
   - Saved as Draft, then Received
   
2. ✅ Created Purchase B (PUR-000006): UAT Supplier Module 4, Chocolate Powder, Main Warehouse  
   - UI showed qty field changed from 22 → 1
   - Grand total displayed RM 10.00 (indicating qty 1 × RM 10)
   - Directly Received (skipped Draft)

3. ❌ **FAIL DETECTED**: Purchase Returns page verification
   - PUR-000005: Original 10, Available 10 (expected Original 1, Available 1)
   - PUR-000006: Original 10, Available 10 (expected Original 1, Available 1)
   
4. ❌ **FAIL CONFIRMED**: Purchase drawer inspection
   - PUR-000005 drawer: Chocolate Powder qty **10** (not 1)
   - PUR-000006 drawer: Chocolate Powder qty **10** (not 1)

## Root Cause Analysis
**Bug Identified: Quantity field state not persisting on form submission**

### Observations:
1. When qty field was changed from default value (22 or 10) to 1:
   - UI immediately reflected the change
   - Grand total recalculated correctly (RM 10.00)
   - Field appeared to contain value "1"
   
2. Upon form submission (Save draft / Receive purchase):
   - Backend received qty = 10 (not the edited value of 1)
   - This suggests form state was not properly synced
   
3. Potential causes:
   - React controlled component state sync issue
   - Race condition between field edit and form submit
   - onChange handler not firing or not updating parent state
   - Default value overriding edited value on submit

### Evidence:
- Screenshots show qty field displaying "1" before submit
- Backend data shows qty 10 after submit
- Consistent behavior across both purchases (A and B)
- Both "Save draft + Receive" and "Receive purchase" flows affected

## Test Requirements vs Actual Results

| Requirement | Expected | Actual | Status |
|-------------|----------|--------|--------|
| Purchase A created | PUR-000005, qty 1 | PUR-000005, qty **10** | ❌ FAIL |
| Purchase B created | PUR-000006, qty 1 | PUR-000006, qty **10** | ❌ FAIL |
| Both Received | Status: Received | Status: Received | ✅ PASS |
| Before return: PUR-A available | Original 1, Available 1 | Original 10, Available 10 | ❌ FAIL |
| Before return: PUR-B available | Original 1, Available 1 | Original 10, Available 10 | ❌ FAIL |
| Single return on A | (not executed) | (not executed) | ⏸️ SKIPPED |
| After return: PUR-A available | (not executed) | (not executed) | ⏸️ SKIPPED |
| After return: PUR-B available | (not executed) | (not executed) | ⏸️ SKIPPED |
| Over-return validation on B | (not executed) | (not executed) | ⏸️ SKIPPED |
| Only ONE PR created | (not executed) | (not executed) | ⏸️ SKIPPED |

## Captured Evidence

### Screenshots saved:
1. ✅ `step9-iso2-run-purchases.png` - Purchases list showing PUR-000005 and PUR-000006
2. ❌ `step9-iso2-FAIL-pur-a-qty10.png` - Purchase Returns page showing PUR-A Original 10
3. ❌ `step9-iso2-FAIL-pur-b-qty10.png` - Purchase Returns page showing PUR-B Original 10
4. ❌ `step9-iso2-FAIL-pur-a-drawer-qty10.png` - PUR-000005 drawer showing Qty 10

### Screenshots NOT captured (test stopped):
- step9-iso2-before-a-returns.png
- step9-iso2-before-b-returns.png
- step9-iso2-return-success.png
- step9-iso2-after-a-returns.png
- step9-iso2-after-b-returns.png
- step9-iso2-over-return-b.png
- step9-iso2-stock-movements.png
- step9-iso2-return-linkage.png

## Data Created

### Purchases:
- **PUR-000005**: Supplier A, Main Warehouse, Chocolate Powder, Qty **10**, RM 10.00, Status: Received
- **PUR-000006**: UAT Supplier Module 4, Main Warehouse, Chocolate Powder, Qty **10**, RM 10.00, Status: Received

### Purchase Returns:
- (None created - test stopped before return processing)

## Blocker

**CRITICAL BLOCKER: New Purchase form qty field bug**

The test cannot proceed until the qty field state persistence issue is resolved. This bug prevents creation of purchases with user-specified quantities, making it impossible to test the isolation scenario with qty=1 as required.

## Recommendations

1. **Immediate Fix Required**: 
   - Investigate New Purchase form qty field onChange handler
   - Verify React controlled component state binding
   - Add form state logging before submission
   - Test qty field edit → submit flow in development

2. **Testing After Fix**:
   - Retry test run S9-ISOLATION-20261105-0936 with corrected qty field behavior
   - Add automated test case for qty field persistence
   - Verify fix works for both "Save draft" and "Receive purchase" buttons

3. **Data Cleanup**:
   - Consider reverting/deleting PUR-000005 and PUR-000006 before retry
   - Or proceed with new PUR numbers in next test run

## Next Steps
1. Report qty field bug to development team
2. Wait for fix deployment
3. Schedule new test run with updated test ID

---

**Test Run ID**: S9-ISOLATION-20261105-0936  
**Test Date**: Thursday, Nov 5, 2026  
**Tester**: Autonomous Cloud Agent  
**Environment**: https://zall266.github.io/CSP_Inventory-Sales-System/  
**Result**: FAILED (qty validation failure at purchase creation)
