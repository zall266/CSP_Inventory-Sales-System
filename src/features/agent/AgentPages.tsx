import { useMemo, useState, type FormEvent } from 'react'
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
} from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { agentStockRows, agentStockTotal } from '@/features/agent/agentModel'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatQty } from '@/utils/format'
import type { Agent, AgentInput } from '@/types'

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
  const agent = (state.agents ?? []).find((item) => item.id === id)
  const warehouse = state.warehouses.find((item) => item.id === agent?.warehouseId)
  const linkedUser = state.users.find((user) => user.id === agent?.userId)
  const [form, setForm] = useState<AgentForm>(emptyForm)
  const [editing, setEditing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

  if (!canView) return <PermissionDenied subtitle="You do not have access to Agent." />
  if (!agent) return <PageHeader title="Agent" subtitle="Not found." />

  const stockRows = canStock ? agentStockRows(state, agent.warehouseId) : []
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
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Linked stock holder / internal warehouse</div>
        <div className="font-medium">{warehouse?.name ?? warehouseName(agent.warehouseId)}</div>
        <div className="text-sm text-slate-500">{warehouse?.code ?? '—'} · {agent.warehouseId}</div>
        <div className="text-xs text-slate-400">Internal inventory holder. Not shown in company warehouse filters.</div>
      </Card>
      {canStock && (
        <Card>
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="text-sm font-semibold">Stock</div>
            <div className="text-xs text-slate-400">From InventoryRow in the agent warehouse.</div>
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
                    <td className="font-medium">{row.product.name}</td>
                    <td className="tabular">{formatQty(row.qty)} {row.product.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!stockRows.length && <EmptyState title="No stock yet" hint="Agent stock is stored in the linked warehouse." />}
          </div>
        </Card>
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
