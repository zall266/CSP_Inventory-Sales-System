import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  FilterRow,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from '@/components/ui'
import { paymentLabel } from '@/components/ProductMark'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import {
  activeAgents,
  agentBankDetailsComplete,
  agentSalesForAgent,
  agentStockRows,
  agentStockTotal,
  calcAgentSaleEarnings,
  canUserRequestWithdrawalForAgent,
  companyWarehouses,
  configuredAgentPrice,
  isAllowedWithdrawalReceiptFile,
  linkedAgentForUser,
  currentLinkedAgent,
  saleEarningForAgentSale,
  snapshotAgentBankDetails,
  sortAgentWithdrawals,
  summarizeAgentEarnings,
  withdrawalsForAgent,
} from '@/features/agent/agentModel'
import { hasPermission } from '@/features/settings/permissions'
import { productIsSellable } from '@/features/products/masterData'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatDateTime, formatMoney, formatQty, round2 } from '@/utils/format'
import type { Agent, AgentInput, AppState, PaymentMethod, Product } from '@/types'

type AgentForm = {
  name: string
  code: string
  userId: string
  bankName: string
  accountHolder: string
  bankAccount: string
}

const emptyForm: AgentForm = {
  name: '',
  code: '',
  userId: '',
  bankName: '',
  accountHolder: '',
  bankAccount: '',
}

function formFromAgent(agent: Agent): AgentForm {
  return {
    name: agent.name,
    code: agent.code,
    userId: agent.userId ?? '',
    bankName: agent.bankName,
    accountHolder: agent.accountHolder,
    bankAccount: agent.bankAccount,
  }
}

function toInput(form: AgentForm): AgentInput {
  return {
    name: form.name,
    code: form.code,
    userId: form.userId || undefined,
    bankName: form.bankName,
    accountHolder: form.accountHolder,
    bankAccount: form.bankAccount,
  }
}

function canProcessAgentWithdrawals(state: AppState) {
  return hasPermission(state, 'agent.withdrawal.process') && !linkedAgentForUser(state.agents ?? [], state.ui.currentUserId)
}

function productOptionLabel(product: Product) {
  return `${product.name} · ${product.sku} · ${product.unit}`
}

function AgentSaleModal({
  open,
  agentId,
  onClose,
}: {
  open: boolean
  agentId: string
  onClose: () => void
}) {
  const state = useStore()
  const api = useApi()
  const agent = (state.agents ?? []).find((item) => item.id === agentId)
  const products = state.products.filter((product) => productIsSellable(product) && configuredAgentPrice(product) !== null)
  const stockedId = products.find((product) => api.getProductQty(product.id, agent?.warehouseId) > 0)?.id
  const defaultProductId = stockedId ?? products.find((product) => product.id === 'p-pack-mt')?.id ?? products[0]?.id ?? ''
  const methods = state.settings.enabledPaymentMethods
  const defaultProduct = products.find((item) => item.id === defaultProductId)
  const defaultAgentPrice = configuredAgentPrice(defaultProduct)
  const defaultSelling = defaultProduct
    ? defaultAgentPrice !== null
      ? Math.max(defaultProduct.sellingPrice, defaultAgentPrice)
      : defaultProduct.sellingPrice
    : 0
  const [productId, setProductId] = useState(defaultProductId)
  const [qty, setQty] = useState(0)
  const [sellingPrice, setSellingPrice] = useState(defaultSelling)
  const [delivery, setDelivery] = useState(0)
  const [customerId, setCustomerId] = useState(state.settings.defaultCustomerId)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(methods.includes('cash') ? 'cash' : methods[0] ?? 'cash')
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const requestIdRef = useRef('')

  const product = products.find((item) => item.id === productId)
  const available = productId && agent?.warehouseId ? api.getProductQty(productId, agent.warehouseId) : 0
  const agentPrice = configuredAgentPrice(product)
  const qtyValue = Number(qty) || 0
  const sellingValue = Number(sellingPrice) || 0
  const deliveryValue = round2(Number(delivery) || 0)
  const preview = agentPrice !== null && round2(sellingValue) >= agentPrice
    ? calcAgentSaleEarnings({
        agentPrice,
        sellingPrice: sellingValue,
        qty: qtyValue,
        delivery: deliveryValue,
      })
    : null
  const belowAgentPrice = agentPrice !== null && round2(sellingValue) < agentPrice
  const customerTotal = preview?.customerPays ?? round2(qtyValue * sellingValue + deliveryValue)
  const afterQty = round2(available - qtyValue)
  const agentLabel = agent ? (state.warehouses.find((warehouse) => warehouse.id === agent.warehouseId)?.name ?? agent.name) : '—'

  const chooseProduct = (nextId: string) => {
    setProductId(nextId)
    const next = products.find((item) => item.id === nextId)
    const nextAgentPrice = configuredAgentPrice(next)
    const listPrice = next?.sellingPrice ?? 0
    setSellingPrice(nextAgentPrice !== null ? Math.max(listPrice, nextAgentPrice) : listPrice)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!productId) {
      api.toast('Please select a product.', undefined, 'warning')
      return
    }
    if (!Number.isFinite(qty) || !(qty > 0)) {
      api.toast('Quantity must be greater than 0.', undefined, 'warning')
      return
    }
    if (qty > available) {
      api.toast('Insufficient stock.', `Available: ${formatQty(available)}.`, 'danger')
      return
    }
    if (agentPrice === null) {
      api.toast('Agent Price must be configured', 'Set Agent Price on the product before creating an agent sale.', 'warning')
      return
    }
    if (round2(Number(sellingPrice)) < agentPrice) {
      api.toast('Selling price cannot be lower than Agent Price.', undefined, 'warning')
      return
    }
    if (!Number.isFinite(Number(delivery)) || Number(delivery) < 0) {
      api.toast('Unable to complete sale. Please try again.', undefined, 'warning')
      return
    }
    requestIdRef.current = `asr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    setConfirm(true)
  }

  const confirmSale = () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    const sale = api.createAgentSale({
      agentId,
      productId,
      qty,
      sellingPrice,
      delivery: deliveryValue,
      customerId,
      paymentMethod,
      notes,
      requestId: requestIdRef.current,
    })
    submittingRef.current = false
    setSubmitting(false)
    setConfirm(false)
    if (sale) {
      setQty(0)
      setDelivery(0)
      setNotes('')
      onClose()
    }
  }

  const close = () => {
    if (submittingRef.current) return
    setConfirm(false)
    onClose()
  }

  return (
    <>
      <Modal open={open} onClose={close} title="Create Sale" width="max-w-xl">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Field label="Agent" className="sm:col-span-2">
            <Input disabled value={agentLabel} />
          </Field>
          <Field label="Product" className="sm:col-span-2">
            <Select value={productId} onChange={(event) => chooseProduct(event.target.value)}>
              <option value="">Select product</option>
              {products.map((item) => (
                <option key={item.id} value={item.id}>{productOptionLabel(item)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Agent Price">
            <Input disabled value={agentPrice === null ? 'Not configured' : formatMoney(agentPrice)} />
          </Field>
          <Field label="Available stock">
            <Input disabled value={product ? `${formatQty(available)} ${product.unit}` : '—'} />
          </Field>
          <Field label="Quantity">
            <Input type="number" min={0} step="0.01" value={qty || ''} onChange={(event) => setQty(Number(event.target.value))} />
          </Field>
          <Field label="Selling price">
            <Input type="number" min={0} step="0.01" value={sellingPrice} onChange={(event) => setSellingPrice(Number(event.target.value))} />
            {belowAgentPrice && (
              <div className="text-xs text-amber-700">Selling price cannot be lower than Agent Price.</div>
            )}
            {agentPrice === null && product && (
              <div className="text-xs text-amber-700">Agent Price must be configured.</div>
            )}
          </Field>
          <Field label="Delivery charge">
            <Input type="number" min={0} step="0.01" value={delivery} onChange={(event) => setDelivery(Number(event.target.value))} />
          </Field>
          <Field label="Customer total">
            <Input disabled value={formatMoney(customerTotal)} />
          </Field>
          <Field label="Agent earnings" className="sm:col-span-2">
            <Input
              disabled
              value={
                agentPrice === null
                  ? 'Configure Agent Price to calculate earnings'
                  : belowAgentPrice
                    ? 'Selling price cannot be lower than Agent Price'
                    : preview
                      ? `${formatMoney(preview.totalEarnings)} · Markup ${formatMoney(preview.productMarkup)} · Delivery ${formatMoney(preview.deliveryEarnings)}`
                      : 'Configure Agent Price to calculate earnings'
              }
            />
          </Field>
          <Field label="Customer">
            <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              {state.customers.filter((customer) => customer.status === 'active').map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Payment method">
            <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {methods.map((method) => (
                <option key={method} value={method}>{paymentLabel(method)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" size="lg">Create Sale</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirm}
        onClose={() => { if (!submittingRef.current) setConfirm(false) }}
        title="Confirm Agent Sale?"
        message={`Agent:\n${agentLabel}\nProduct:\n${product ? productOptionLabel(product) : '—'}\nAgent Price:\n${agentPrice === null ? 'Not configured' : formatMoney(agentPrice)}\nAvailable:\n${formatQty(available)} ${product?.unit ?? ''}\nSale Quantity:\n${formatQty(qty)} ${product?.unit ?? ''}\nAfter Sale:\n${formatQty(afterQty)} ${product?.unit ?? ''}\nSelling Price:\n${formatMoney(sellingPrice)}\nDelivery:\n${formatMoney(deliveryValue)}\nCustomer Total:\n${formatMoney(customerTotal)}\nAgent Earnings:\nMarkup ${formatMoney(preview?.productMarkup ?? 0)}\nDelivery ${formatMoney(preview?.deliveryEarnings ?? 0)}\nTotal ${formatMoney(preview?.totalEarnings ?? 0)}`}
        confirmLabel={submitting ? 'Processing...' : 'Confirm Sale'}
        confirmDisabled={submitting}
        onConfirm={confirmSale}
      />
    </>
  )
}

function AgentWithdrawalModal({
  open,
  agentId,
  onClose,
}: {
  open: boolean
  agentId: string
  onClose: () => void
}) {
  const state = useStore()
  const api = useApi()
  const agent = (state.agents ?? []).find((item) => item.id === agentId)
  const earnings = summarizeAgentEarnings(state.agentEarningLedgers ?? [], agentId)
  const bank = agent ? snapshotAgentBankDetails(agent) : { bankName: '', accountHolder: '', accountNumber: '' }
  const bankComplete = agentBankDetailsComplete(agent)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const requestIdRef = useRef('')

  const parsedAmount = Number(amount)
  const roundedAmount = Number.isFinite(parsedAmount) ? round2(parsedAmount) : 0
  const remaining = round2(earnings.available - roundedAmount)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!bankComplete) {
      api.toast(
        'Complete bank/payment information first',
        'Add bank name, account holder, and account number on the agent profile before requesting a withdrawal.',
        'warning',
      )
      return
    }
    if (!Number.isFinite(parsedAmount) || !(roundedAmount > 0)) {
      api.toast('Withdrawal amount must be greater than 0.', undefined, 'warning')
      return
    }
    if (roundedAmount > earnings.available) {
      api.toast('Withdrawal amount cannot exceed available earnings.', `Available: ${formatMoney(earnings.available)}.`, 'danger')
      return
    }
    requestIdRef.current = `awr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    setConfirm(true)
  }

  const confirmWithdrawal = () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    const withdrawal = api.requestAgentWithdrawal({
      agentId,
      amount: roundedAmount,
      notes,
      requestId: requestIdRef.current,
    })
    submittingRef.current = false
    setSubmitting(false)
    setConfirm(false)
    if (withdrawal) {
      setAmount('')
      setNotes('')
      onClose()
    }
  }

  const close = () => {
    if (submittingRef.current) return
    setConfirm(false)
    onClose()
  }

  return (
    <>
      <Modal open={open} onClose={close} title="Request Withdrawal" width="max-w-xl">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Field label="Available balance" className="sm:col-span-2">
            <Input disabled value={formatMoney(earnings.available)} />
          </Field>
          <Field label="Amount" className="sm:col-span-2">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="Bank name">
            <Input disabled value={bank.bankName || '—'} />
          </Field>
          <Field label="Account holder">
            <Input disabled value={bank.accountHolder || '—'} />
          </Field>
          <Field label="Account number" className="sm:col-span-2">
            <Input disabled value={bank.accountNumber || '—'} />
          </Field>
          {!bankComplete && (
            <div className="sm:col-span-2 text-xs text-amber-700">
              Complete bank/payment information first. Bank details are managed on the agent profile.
            </div>
          )}
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" size="lg">Request Withdrawal</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirm}
        onClose={() => { if (!submittingRef.current) setConfirm(false) }}
        title="Confirm Withdrawal"
        message={`Agent:\n${agent?.name ?? '—'}\nAvailable:\n${formatMoney(earnings.available)}\nWithdrawal:\n${formatMoney(roundedAmount)}\nRemaining:\n${formatMoney(remaining)}\nBank:\n${bank.bankName || '—'}\nAccount Holder:\n${bank.accountHolder || '—'}\nAccount:\n${bank.accountNumber || '—'}`}
        confirmLabel="Confirm Withdrawal"
        confirmDisabled={submitting}
        onConfirm={confirmWithdrawal}
      />
    </>
  )
}

function AgentWithdrawalProcessModal({
  open,
  withdrawalId,
  onClose,
}: {
  open: boolean
  withdrawalId: string
  onClose: () => void
}) {
  const state = useStore()
  const api = useApi()
  const fileRef = useRef<HTMLInputElement>(null)
  const canProcess = canProcessAgentWithdrawals(state)
  const withdrawal = (state.agentWithdrawals ?? []).find((row) => row.id === withdrawalId)
  const agent = state.agents.find((item) => item.id === withdrawal?.agentId)
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [receiptUrl, setReceiptUrl] = useState('')
  const [receiptName, setReceiptName] = useState('')
  const [receiptError, setReceiptError] = useState('')
  const [payConfirm, setPayConfirm] = useState(false)
  const [rejectConfirm, setRejectConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const payRequestRef = useRef('')
  const cancelRequestRef = useRef('')

  const requested = withdrawal?.status === 'requested'
  const defaultDate = withdrawal?.requestedAt?.slice(0, 10) || ''

  const pickReceipt = (file: File | undefined) => {
    setReceiptError('')
    if (!file) return
    if (!isAllowedWithdrawalReceiptFile(file)) {
      setReceiptError('Use a PNG, JPG or WebP image up to 5 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      if (!result.startsWith('data:image/')) {
        setReceiptError('That file could not be read as an image.')
        return
      }
      setReceiptUrl(result)
      setReceiptName(file.name)
    }
    reader.onerror = () => setReceiptError('That file could not be read as an image.')
    reader.readAsDataURL(file)
  }

  const submitPay = (event: FormEvent) => {
    event.preventDefault()
    if (!canProcess || !withdrawal || !requested) return
    if (!paymentReference.trim()) {
      api.toast('Payment reference is required.', undefined, 'warning')
      return
    }
    if (!(paymentDate || defaultDate)) {
      api.toast('Payment date is required.', undefined, 'warning')
      return
    }
    if (!receiptUrl) {
      api.toast('Payment receipt is required.', 'Upload a PNG, JPG or WebP image up to 5 MB.', 'warning')
      return
    }
    payRequestRef.current = `awp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    setPayConfirm(true)
  }

  const confirmPay = () => {
    if (!withdrawal || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    const paid = api.payAgentWithdrawal({
      withdrawalId: withdrawal.id,
      paymentReference,
      paymentDate: paymentDate || defaultDate,
      receiptUrl,
      receiptName,
      requestId: payRequestRef.current,
    })
    submittingRef.current = false
    setSubmitting(false)
    setPayConfirm(false)
    if (paid) onClose()
  }

  const confirmReject = () => {
    if (!withdrawal || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    cancelRequestRef.current = cancelRequestRef.current || `awc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const cancelled = api.cancelAgentWithdrawal({
      withdrawalId: withdrawal.id,
      requestId: cancelRequestRef.current,
    })
    submittingRef.current = false
    setSubmitting(false)
    setRejectConfirm(false)
    if (cancelled) onClose()
  }

  const close = () => {
    if (submittingRef.current) return
    setPayConfirm(false)
    setRejectConfirm(false)
    onClose()
  }

  return (
    <>
      <Modal open={open} onClose={close} title="Withdrawal" width="max-w-xl">
        {!withdrawal ? (
          <div className="text-sm text-slate-500">Withdrawal not found.</div>
        ) : (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitPay}>
            <Field label="Agent" className="sm:col-span-2">
              <Input disabled value={agent?.name ?? '—'} />
            </Field>
            <Field label="Withdrawal ID">
              <Input disabled value={withdrawal.id} />
            </Field>
            <Field label="Status">
              <div className="pt-2"><StatusBadge status={withdrawal.status} /></div>
            </Field>
            <Field label="Requested date" className="sm:col-span-2">
              <Input disabled value={formatDateTime(withdrawal.requestedAt)} />
            </Field>
            <Field label="Amount" className="sm:col-span-2">
              <Input disabled value={formatMoney(withdrawal.amount)} />
            </Field>
            <Field label="Bank">
              <Input disabled value={withdrawal.bankName || '—'} />
            </Field>
            <Field label="Account holder">
              <Input disabled value={withdrawal.accountHolder || '—'} />
            </Field>
            <Field label="Account number" className="sm:col-span-2">
              <Input disabled value={withdrawal.accountNumber || '—'} />
            </Field>
            {withdrawal.notes ? (
              <Field label="Notes" className="sm:col-span-2">
                <Textarea disabled rows={2} value={withdrawal.notes} />
              </Field>
            ) : null}
            {withdrawal.status === 'paid' && (
              <>
                <Field label="Payment reference">
                  <Input disabled value={withdrawal.paymentReference || '—'} />
                </Field>
                <Field label="Payment date">
                  <Input disabled value={withdrawal.paymentDate || '—'} />
                </Field>
                <div className="sm:col-span-2 space-y-2">
                  <div className="text-xs font-medium text-slate-500">Receipt</div>
                  {withdrawal.receiptUrl ? (
                    <img src={withdrawal.receiptUrl} alt={withdrawal.receiptName || 'Receipt'} className="max-h-40 rounded-xl border border-slate-200 object-contain" />
                  ) : (
                    <div className="text-sm text-slate-500">Receipt attached</div>
                  )}
                </div>
              </>
            )}
            {requested && canProcess && (
              <>
                <Field label="Payment reference">
                  <Input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
                </Field>
                <Field label="Payment date">
                  <Input type="date" value={paymentDate || defaultDate} onChange={(event) => setPaymentDate(event.target.value)} />
                </Field>
                <div className="sm:col-span-2 space-y-2">
                  <div className="text-xs font-medium text-slate-500">Payment receipt</div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={(event) => {
                      pickReceipt(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                  {receiptUrl ? (
                    <div className="flex items-start gap-3">
                      <img src={receiptUrl} alt={receiptName || 'Receipt'} className="max-h-24 rounded-xl border border-slate-200 object-contain" />
                      <div className="text-sm text-slate-600">{receiptName || 'Attached'}</div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-400">No receipt uploaded</div>
                  )}
                  <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                    {receiptUrl ? 'Replace receipt' : 'Upload receipt'}
                  </Button>
                  {receiptError ? <div className="text-sm text-rose-600">{receiptError}</div> : null}
                </div>
                <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                  <Button type="button" variant="secondary" onClick={close}>Close</Button>
                  <Button type="button" variant="danger" onClick={() => {
                    cancelRequestRef.current = `awc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
                    setRejectConfirm(true)
                  }}>
                    Reject
                  </Button>
                  <Button type="submit" size="lg">Confirm Paid</Button>
                </div>
              </>
            )}
            {!(requested && canProcess) && (
              <div className="flex justify-end sm:col-span-2">
                <Button type="button" variant="secondary" onClick={close}>Close</Button>
              </div>
            )}
          </form>
        )}
      </Modal>
      <ConfirmDialog
        open={payConfirm}
        onClose={() => { if (!submittingRef.current) setPayConfirm(false) }}
        title="Mark this withdrawal as PAID?"
        message={`Agent:\n${agent?.name ?? '—'}\nAmount:\n${formatMoney(withdrawal?.amount ?? 0)}\nBank:\n${withdrawal?.bankName || '—'}\nAccount:\n${withdrawal?.accountNumber || '—'}\nPayment Reference:\n${paymentReference.trim() || '—'}\nPayment Date:\n${paymentDate || defaultDate || '—'}\nReceipt:\nAttached`}
        confirmLabel="Confirm Paid"
        confirmDisabled={submitting}
        onConfirm={confirmPay}
      />
      <ConfirmDialog
        open={rejectConfirm}
        onClose={() => { if (!submittingRef.current) setRejectConfirm(false) }}
        title="Cancel this withdrawal request?"
        message={`Agent:\n${agent?.name ?? '—'}\nAmount:\n${formatMoney(withdrawal?.amount ?? 0)}\nThis will return ${formatMoney(withdrawal?.amount ?? 0)} to Available Earnings.`}
        confirmLabel="Reject Withdrawal"
        tone="danger"
        confirmDisabled={submitting}
        onConfirm={confirmReject}
      />
    </>
  )
}

function AgentTransferModal({
  open,
  agentId,
  onClose,
}: {
  open: boolean
  agentId: string
  onClose: () => void
}) {
  const state = useStore()
  const api = useApi()
  const companies = companyWarehouses(state.warehouses)
  const agents = activeAgents(state.agents ?? [])
  const products = state.products.filter((product) => product.status === 'active')
  const defaultFrom = companies.find((warehouse) => warehouse.id === state.settings.defaultWarehouseId)?.id ?? companies[0]?.id ?? ''
  const [fromWarehouseId, setFromWarehouseId] = useState(defaultFrom)
  const [toAgentId, setToAgentId] = useState(agentId)
  const [productId, setProductId] = useState(products.find((item) => item.id === 'p-pack-mt')?.id ?? products[0]?.id ?? '')
  const [qty, setQty] = useState(0)
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)

  const product = products.find((item) => item.id === productId)
  const fromWarehouse = companies.find((warehouse) => warehouse.id === fromWarehouseId)
  const toAgent = agents.find((agent) => agent.id === toAgentId)
  const available = productId && fromWarehouseId ? api.getProductQty(productId, fromWarehouseId) : 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!fromWarehouseId) {
      api.toast('Select a source warehouse', undefined, 'warning')
      return
    }
    if (!toAgentId) {
      api.toast('Select an agent', undefined, 'warning')
      return
    }
    if (!productId) {
      api.toast('Select a product', undefined, 'warning')
      return
    }
    if (!(qty > 0)) {
      api.toast('Enter a quantity', undefined, 'warning')
      return
    }
    if (qty > available) {
      api.toast('Insufficient stock.', `Available: ${available}.`, 'danger')
      return
    }
    setConfirm(true)
  }

  const confirmTransfer = () => {
    const ok = api.transferStockToAgent({
      agentId: toAgentId,
      fromWarehouseId,
      productId,
      qty,
      notes,
    })
    setConfirm(false)
    if (ok) {
      setQty(0)
      setNotes('')
      close()
    }
  }

  const close = () => {
    setConfirm(false)
    onClose()
  }

  return (
    <>
      <Modal open={open} onClose={close} title="Transfer Stock" width="max-w-xl">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Field label="From warehouse">
            <Select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>
              <option value="">Select warehouse</option>
              {companies.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="To agent">
            <Select value={toAgentId} onChange={(e) => setToAgentId(e.target.value)}>
              <option value="">Select agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Product" className="sm:col-span-2">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Select product</option>
              {products.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Available stock">
            <Input disabled value={product ? `${formatQty(available)} ${product.unit}` : '—'} />
          </Field>
          <Field label="Quantity">
            <Input type="number" min={0} step="0.01" value={qty || ''} onChange={(e) => setQty(Number(e.target.value))} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit">Transfer Stock</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirm transfer"
        message={`Transfer:\n${formatQty(qty)} ${product?.unit ?? ''}\n${product?.name ?? 'Product'}\n\nFrom:\n${fromWarehouse?.name ?? '—'}\n\nTo:\n${toAgent ? (state.warehouses.find((warehouse) => warehouse.id === toAgent.warehouseId)?.name ?? toAgent.name) : '—'}`}
        confirmLabel="Confirm Transfer"
        onConfirm={confirmTransfer}
      />
    </>
  )
}

function AgentFormModal({
  open,
  title,
  form,
  setForm,
  users,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  form: AgentForm
  setForm: (form: AgentForm) => void
  users: Array<{ id: string; name: string }>
  onClose: () => void
  onSubmit: () => void
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
  }
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-xl">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Agent name" className="sm:col-span-2">
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Code">
          <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="AG-JB" />
        </Field>
        <Field label="Linked user">
          <Select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
            <option value="">None</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Bank name">
          <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
        </Field>
        <Field label="Account holder">
          <Input value={form.accountHolder} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} />
        </Field>
        <Field label="Bank account" className="sm:col-span-2">
          <Input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Modal>
  )
}

export function AgentsPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const linked = currentLinkedAgent(state)
  const canView = hasPermission(state, 'agent.view') || hasPermission(state, 'agent.manage') || Boolean(linked)
  const canManage = hasPermission(state, 'agent.manage')
  const canStock = hasPermission(state, 'agent.stock.view') || canManage || Boolean(linked)
  const canProcess = canProcessAgentWithdrawals(state)
  const [query, setQuery] = useState('')
  const [queueFilter, setQueueFilter] = useState<'all' | 'requested' | 'paid' | 'cancelled'>('requested')
  const [processId, setProcessId] = useState('')
  const [form, setForm] = useState<AgentForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [statusId, setStatusId] = useState('')

  const agents = state.agents ?? []
  const rows = useMemo(
    () =>
      agents
        .filter((agent) => (linked ? agent.id === linked.id : true))
        .filter((agent) =>
          `${agent.name} ${agent.code} ${agent.bankAccount}`.toLowerCase().includes(query.toLowerCase()),
        ),
    [agents, query, linked],
  )
  const linkedUserIds = new Set(agents.map((agent) => agent.userId).filter(Boolean))
  const formUsers = state.users.filter((user) => {
    if (user.status !== 'active') return false
    if (editingId) {
      const current = agents.find((agent) => agent.id === editingId)
      if (user.id === current?.userId) return true
    }
    return !linkedUserIds.has(user.id)
  })
  const statusTarget = agents.find((agent) => agent.id === statusId)

  if (!canView) return <PermissionDenied subtitle="You do not have access to Agent." />

  const queueRows = canProcess
    ? sortAgentWithdrawals(state.agentWithdrawals ?? []).filter((row) => queueFilter === 'all' || row.status === queueFilter)
    : []

  const openCreate = () => {
    setForm(emptyForm)
    setEditingId(null)
    setCreating(true)
  }
  const openEdit = (agent: Agent) => {
    setForm(formFromAgent(agent))
    setEditingId(agent.id)
    setCreating(false)
  }
  const closeForm = () => {
    setCreating(false)
    setEditingId(null)
  }
  const save = () => {
    if (editingId) {
      if (api.updateAgent(editingId, toInput(form))) closeForm()
      return
    }
    const created = api.createAgent(toInput(form))
    if (created) closeForm()
  }

  return (
    <div>
      <PageHeader
        title="Agent"
        subtitle="Agent master records and internal stock holders."
        actions={canManage ? <Button onClick={openCreate}><Plus size={16} /> Add Agent</Button> : undefined}
      />
      <FilterRow>
        <Input placeholder="Search agent or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Code</th>
                {canStock && <th>Stock</th>}
                <th>Status</th>
                <th>Bank Account</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((agent) => (
                <tr key={agent.id} onClick={() => navigate(`/sales/agents/${agent.id}`)}>
                  <td className="font-medium">{agent.name}</td>
                  <td>{agent.code}</td>
                  {canStock && <td className="tabular">{formatQty(agentStockTotal(state, agent.warehouseId))}</td>}
                  <td><StatusBadge status={agent.status} /></td>
                  <td>{agent.bankAccount || '—'}</td>
                  <td>
                    <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="text-xs font-medium text-indigo-600" onClick={() => navigate(`/sales/agents/${agent.id}`)}>View</button>
                      {canManage && (
                        <>
                          <button type="button" className="text-xs font-medium text-slate-500" onClick={() => openEdit(agent)}>Edit</button>
                          <button
                            type="button"
                            className="text-xs font-medium text-slate-500"
                            onClick={() => setStatusId(agent.id)}
                          >
                            {agent.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState title="No agents yet" hint={canManage ? 'Add an agent to create an internal stock holder.' : undefined} />}
        </div>
      </Card>
      {canProcess && (
        <Card className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <div className="text-sm font-semibold">Withdrawal Requests</div>
              <div className="text-xs text-slate-400">Process requested withdrawals. Payout is recorded after the bank transfer.</div>
            </div>
            <Select value={queueFilter} onChange={(event) => setQueueFilter(event.target.value as typeof queueFilter)}>
              <option value="requested">Requested</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </Select>
          </div>
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Withdrawal ID</th>
                  <th>Agent</th>
                  <th>Request Date</th>
                  <th>Amount</th>
                  <th>Bank Name</th>
                  <th>Account Holder</th>
                  <th>Account Number</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {queueRows.map((row) => {
                  const agentName = agents.find((item) => item.id === row.agentId)?.name ?? row.agentId
                  return (
                    <tr key={row.id} onClick={() => setProcessId(row.id)}>
                      <td className="font-medium">{row.id}</td>
                      <td>{agentName}</td>
                      <td>{formatDate(row.requestedAt)}</td>
                      <td className="tabular">{formatMoney(row.amount)}</td>
                      <td>{row.bankName || '—'}</td>
                      <td>{row.accountHolder || '—'}</td>
                      <td>{row.accountNumber || '—'}</td>
                      <td><StatusBadge status={row.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!queueRows.length && <EmptyState title="No withdrawal requests" hint="Requested withdrawals will appear here for payout." />}
          </div>
        </Card>
      )}
      <AgentFormModal
        open={creating || Boolean(editingId)}
        title={editingId ? 'Edit Agent' : 'Add Agent'}
        form={form}
        setForm={setForm}
        users={formUsers}
        onClose={closeForm}
        onSubmit={save}
      />
      <ConfirmDialog
        open={Boolean(statusTarget)}
        onClose={() => setStatusId('')}
        title={statusTarget?.status === 'active' ? 'Deactivate agent' : 'Activate agent'}
        message={
          statusTarget?.status === 'active'
            ? `${statusTarget.name} will be set to Inactive. Existing stock and history stay in place.`
            : `${statusTarget?.name} will be set to Active.`
        }
        confirmLabel={statusTarget?.status === 'active' ? 'Deactivate' : 'Activate'}
        tone={statusTarget?.status === 'active' ? 'danger' : 'primary'}
        onConfirm={() => {
          if (!statusTarget) return
          api.setAgentStatus(statusTarget.id, statusTarget.status === 'active' ? 'inactive' : 'active')
          setStatusId('')
        }}
      />
      {canProcess && (
        <AgentWithdrawalProcessModal
          open={Boolean(processId)}
          withdrawalId={processId}
          onClose={() => setProcessId('')}
        />
      )}
    </div>
  )
}

export function AgentDetailPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const { warehouseName } = useLookups()
  const linked = currentLinkedAgent(state)
  const canView = hasPermission(state, 'agent.view') || hasPermission(state, 'agent.manage') || Boolean(linked)
  const canManage = hasPermission(state, 'agent.manage')
  const canStock = hasPermission(state, 'agent.stock.view') || canManage || Boolean(linked && linked.id === id)
  const canTransfer = hasPermission(state, 'agent.stock.transfer')
  const canSale = hasPermission(state, 'agent.sale.create') || Boolean(linked && linked.id === id)
  const agent = (state.agents ?? []).find((item) => item.id === id)
  const warehouse = state.warehouses.find((item) => item.id === agent?.warehouseId)
  const linkedUser = state.users.find((user) => user.id === agent?.userId)
  const [form, setForm] = useState<AgentForm>(emptyForm)
  const [editing, setEditing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [saleOpen, setSaleOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [processId, setProcessId] = useState('')

  if (!canView) return <PermissionDenied subtitle="You do not have access to Agent." />
  if (!agent) return <PageHeader title="Agent" subtitle="Not found." />
  if (linked && linked.id !== agent.id) return <PermissionDenied subtitle="You can only view your own Agent record." />

  const canWithdraw =
    agent.status === 'active' &&
    hasPermission(state, 'agent.withdrawal.create') &&
    canUserRequestWithdrawalForAgent(state.agents ?? [], state.ui.currentUserId, agent.id)
  const canAdminWithdrawView = hasPermission(state, 'agent.manage') || hasPermission(state, 'agent.withdrawal.process')
  const canProcess = canProcessAgentWithdrawals(state)
  const stockRows = canStock ? agentStockRows(state, agent.warehouseId) : []
  const earnings = summarizeAgentEarnings(state.agentEarningLedgers ?? [], agent.id)
  const history = agentSalesForAgent(state.agentSales ?? [], agent.id)
  const withdrawalHistory = withdrawalsForAgent(state.agentWithdrawals ?? [], agent.id)
  const linkedUserIds = new Set((state.agents ?? []).map((item) => item.userId).filter(Boolean))
  const formUsers = state.users.filter((user) => {
    if (user.status !== 'active') return false
    if (user.id === agent.userId) return true
    return !linkedUserIds.has(user.id)
  })

  return (
    <div>
      <PageHeader
        title={agent.name}
        subtitle={agent.code}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/sales/agents"><Button variant="secondary">Back</Button></Link>
            {canTransfer && agent.status === 'active' && (
              <Button onClick={() => setTransferOpen(true)}>Transfer Stock</Button>
            )}
            {canSale && agent.status === 'active' && (
              <Button onClick={() => setSaleOpen(true)} size="lg">Create Sale</Button>
            )}
            {canManage && <Button variant="secondary" onClick={() => { setForm(formFromAgent(agent)); setEditing(true) }}>Edit</Button>}
            {canManage && (
              <Button
                variant={agent.status === 'active' ? 'danger' : 'secondary'}
                onClick={() => setStatusOpen(true)}
              >
                {agent.status === 'active' ? 'Deactivate' : 'Activate'}
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Agent</div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-slate-500">Name</div>
              <div className="font-medium">{agent.name}</div>
            </div>
            <StatusBadge status={agent.status} />
          </div>
          <div>
            <div className="text-sm text-slate-500">Code</div>
            <div className="font-medium">{agent.code}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">Linked user</div>
            <div className="font-medium">{linkedUser?.name ?? '—'}</div>
          </div>
        </Card>
        <Card className="space-y-3 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Bank details</div>
          <div>
            <div className="text-sm text-slate-500">Bank name</div>
            <div className="font-medium">{agent.bankName || '—'}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">Account holder</div>
            <div className="font-medium">{agent.accountHolder || '—'}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">Bank account</div>
            <div className="font-medium">{agent.bankAccount || '—'}</div>
          </div>
        </Card>
      </div>
      <Card className="mb-5 space-y-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Earnings</div>
          {canWithdraw && (
            <Button onClick={() => setWithdrawOpen(true)} disabled={earnings.available <= 0}>
              Withdraw
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-sm text-slate-500">Available</div>
            <div className="font-medium tabular">{formatMoney(earnings.available)}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">Pending</div>
            <div className="font-medium tabular">{formatMoney(earnings.pendingWithdrawal)}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">Paid</div>
            <div className="font-medium tabular">{formatMoney(earnings.paid)}</div>
          </div>
        </div>
        <div className="text-xs text-slate-400">Earnings apply to sales from this version onward.</div>
      </Card>
      <Card className="mb-5 space-y-2 p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Linked stock holder / internal warehouse</div>
        <div className="font-medium">{warehouse?.name ?? warehouseName(agent.warehouseId)}</div>
        <div className="text-sm text-slate-500">{warehouse?.code ?? '—'} · {agent.warehouseId}</div>
        <div className="text-xs text-slate-400">Internal inventory holder. Not shown in company warehouse filters.</div>
      </Card>
      {canStock && (
        <Card>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <div className="text-sm font-semibold">Stock</div>
              <div className="text-xs text-slate-400">From InventoryRow in the agent warehouse.</div>
            </div>
            {canTransfer && agent.status === 'active' && (
              <Button onClick={() => setTransferOpen(true)}>Transfer Stock</Button>
            )}
          </div>
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {stockRows.map((row) => (
                  <tr key={row.productId} className="cursor-default">
                    <td>
                      <div className="font-medium">{row.product.name}</div>
                      <div className="text-xs text-slate-400">{row.product.sku}</div>
                    </td>
                    <td className="tabular">{formatQty(row.qty)} {row.product.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!stockRows.length && <EmptyState title="No stock yet" hint="Agent stock is stored in the linked warehouse." />}
          </div>
        </Card>
      )}
      <Card className="mt-5">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="text-sm font-semibold">Agent sales</div>
          <div className="text-xs text-slate-400">Confirmed sales from this agent warehouse.</div>
        </div>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Earnings</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {history.map((agentSale) => {
                const sale = state.sales.find((item) => item.id === agentSale.saleId)
                const line = agentSale.items[0]
                const lineProduct = line ? state.products.find((item) => item.id === line.productId) : undefined
                const ledger = saleEarningForAgentSale(state.agentEarningLedgers ?? [], agentSale.id)
                return (
                  <tr key={agentSale.id} className="cursor-default">
                    <td>{formatDate(agentSale.date)}</td>
                    <td className="font-medium">{sale?.invoiceNo ?? '—'}</td>
                    <td>
                      <div>{lineProduct?.name ?? '—'}</div>
                      <div className="text-xs text-slate-400">{lineProduct?.sku ?? line?.productId}</div>
                    </td>
                    <td className="tabular">{line ? `${formatQty(line.qty)} ${lineProduct?.unit ?? ''}` : '—'}</td>
                    <td className="tabular">{formatMoney(sale?.total ?? agentSale.customerPaid)}</td>
                    <td>{paymentLabel(sale?.paymentMethod)}</td>
                    <td className="tabular">
                      {ledger ? formatMoney(ledger.amount) : 'No earnings ledger'}
                    </td>
                    <td>{sale?.salesperson ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!history.length && (
            <EmptyState title="No agent sales yet" hint={canSale && agent.status === 'active' ? 'Create a sale from this agent stock.' : undefined} />
          )}
        </div>
      </Card>
      <Card className="mt-5">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="text-sm font-semibold">Withdrawals</div>
          <div className="text-xs text-slate-400">Withdrawal history from available earnings.</div>
        </div>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                {canAdminWithdrawView && <th>Agent</th>}
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Bank</th>
                <th>Account Holder</th>
                {canAdminWithdrawView && <th>Account Number</th>}
                <th>Payment Reference</th>
                <th>Payment Date</th>
                <th>Receipt</th>
                {canAdminWithdrawView && <th>Requested By</th>}
                {canProcess && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {withdrawalHistory.map((row) => {
                const requestedBy = state.users.find((user) => user.id === row.requestedBy)?.name ?? row.requestedBy ?? '—'
                return (
                  <tr
                    key={row.id}
                    className={canProcess ? 'cursor-pointer' : 'cursor-default'}
                    onClick={() => { if (canProcess) setProcessId(row.id) }}
                  >
                    {canAdminWithdrawView && <td className="font-medium">{agent.name}</td>}
                    <td>{formatDate(row.requestedAt)}</td>
                    <td className="tabular">{formatMoney(row.amount)}</td>
                    <td><StatusBadge status={row.status} /></td>
                    <td>{row.bankName || '—'}</td>
                    <td>{row.accountHolder || '—'}</td>
                    {canAdminWithdrawView && <td>{row.accountNumber || '—'}</td>}
                    <td>{row.status === 'paid' ? (row.paymentReference || '—') : '—'}</td>
                    <td>{row.status === 'paid' ? (row.paymentDate || '—') : '—'}</td>
                    <td>{row.status === 'paid' && row.receiptUrl ? 'Attached' : '—'}</td>
                    {canAdminWithdrawView && <td>{requestedBy || '—'}</td>}
                    {canProcess && (
                      <td>
                        {row.status === 'requested' ? (
                          <button
                            type="button"
                            className="text-xs font-medium text-indigo-600"
                            onClick={(event) => { event.stopPropagation(); setProcessId(row.id) }}
                          >
                            Process
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-xs font-medium text-slate-500"
                            onClick={(event) => { event.stopPropagation(); setProcessId(row.id) }}
                          >
                            View
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!withdrawalHistory.length && (
            <EmptyState title="No withdrawals yet" hint={canWithdraw && earnings.available > 0 ? 'Request a withdrawal from available earnings.' : undefined} />
          )}
        </div>
      </Card>
      {canTransfer && (
        <AgentTransferModal open={transferOpen} agentId={agent.id} onClose={() => setTransferOpen(false)} />
      )}
      {canSale && (
        <AgentSaleModal open={saleOpen} agentId={agent.id} onClose={() => setSaleOpen(false)} />
      )}
      {canWithdraw && (
        <AgentWithdrawalModal open={withdrawOpen} agentId={agent.id} onClose={() => setWithdrawOpen(false)} />
      )}
      {canProcess && (
        <AgentWithdrawalProcessModal open={Boolean(processId)} withdrawalId={processId} onClose={() => setProcessId('')} />
      )}
      <AgentFormModal
        open={editing}
        title="Edit Agent"
        form={form}
        setForm={setForm}
        users={formUsers}
        onClose={() => setEditing(false)}
        onSubmit={() => {
          if (api.updateAgent(agent.id, toInput(form))) setEditing(false)
        }}
      />
      <ConfirmDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title={agent.status === 'active' ? 'Deactivate agent' : 'Activate agent'}
        message={
          agent.status === 'active'
            ? `${agent.name} will be set to Inactive. Existing stock and history stay in place.`
            : `${agent.name} will be set to Active.`
        }
        confirmLabel={agent.status === 'active' ? 'Deactivate' : 'Activate'}
        tone={agent.status === 'active' ? 'danger' : 'primary'}
        onConfirm={() => {
          api.setAgentStatus(agent.id, agent.status === 'active' ? 'inactive' : 'active')
          setStatusOpen(false)
        }}
      />
    </div>
  )
}
