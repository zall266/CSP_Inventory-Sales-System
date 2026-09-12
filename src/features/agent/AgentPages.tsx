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
  agentSalesForAgent,
  agentStockRows,
  agentStockTotal,
  calcAgentSaleEarnings,
  companyWarehouses,
  configuredAgentPrice,
  saleEarningForAgentSale,
  summarizeAgentEarnings,
} from '@/features/agent/agentModel'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatMoney, formatQty, round2 } from '@/utils/format'
import type { Agent, AgentInput, PaymentMethod, Product } from '@/types'

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
  const products = state.products.filter((product) => product.status === 'active')
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
  const canView = hasPermission(state, 'agent.view') || hasPermission(state, 'agent.manage')
  const canManage = hasPermission(state, 'agent.manage')
  const canStock = hasPermission(state, 'agent.stock.view') || canManage
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<AgentForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [statusId, setStatusId] = useState('')

  const agents = state.agents ?? []
  const rows = useMemo(
    () =>
      agents.filter((agent) =>
        `${agent.name} ${agent.code} ${agent.bankAccount}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [agents, query],
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
    </div>
  )
}

export function AgentDetailPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const { warehouseName } = useLookups()
  const canView = hasPermission(state, 'agent.view') || hasPermission(state, 'agent.manage')
  const canManage = hasPermission(state, 'agent.manage')
  const canStock = hasPermission(state, 'agent.stock.view') || canManage
  const canTransfer = hasPermission(state, 'agent.stock.transfer')
  const canSale = hasPermission(state, 'agent.sale.create')
  const agent = (state.agents ?? []).find((item) => item.id === id)
  const warehouse = state.warehouses.find((item) => item.id === agent?.warehouseId)
  const linkedUser = state.users.find((user) => user.id === agent?.userId)
  const [form, setForm] = useState<AgentForm>(emptyForm)
  const [editing, setEditing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [saleOpen, setSaleOpen] = useState(false)

  if (!canView) return <PermissionDenied subtitle="You do not have access to Agent." />
  if (!agent) return <PageHeader title="Agent" subtitle="Not found." />

  const stockRows = canStock ? agentStockRows(state, agent.warehouseId) : []
  const earnings = summarizeAgentEarnings(state.agentEarningLedgers ?? [], agent.id)
  const history = agentSalesForAgent(state.agentSales ?? [], agent.id)
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
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Earnings</div>
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
      {canTransfer && (
        <AgentTransferModal open={transferOpen} agentId={agent.id} onClose={() => setTransferOpen(false)} />
      )}
      {canSale && (
        <AgentSaleModal open={saleOpen} agentId={agent.id} onClose={() => setSaleOpen(false)} />
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
