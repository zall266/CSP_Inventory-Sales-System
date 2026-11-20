import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  addProductToCart,
  beginPosSubmit,
  cartCount,
  cartSubtotal,
  endPosSubmit,
  productMatchesQuery,
  setCartQty,
  type CartLine,
} from './posCart.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const posPage = fs.readFileSync(path.join(root, 'features/pos/PosPage.tsx'), 'utf8')
const posCart = fs.readFileSync(path.join(root, 'features/pos/posCart.ts'), 'utf8')
const productMark = fs.readFileSync(path.join(root, 'components/ProductMark.tsx'), 'utf8')
const dbSrc = fs.readFileSync(path.join(root, 'store/db.ts'), 'utf8')

const companyCap = { capToAvailable: false, available: 2 }
const agentCap = { capToAvailable: true, available: 2 }

function money(cart: CartLine[]) {
  return { count: cartCount(cart), total: cartSubtotal(cart) }
}

test('adding products updates cart count and total immediately', () => {
  let cart: CartLine[] = []
  cart = addProductToCart(cart, 'p-wf', 32, companyCap)
  assert.deepEqual(money(cart), { count: 1, total: 32 })
  cart = addProductToCart(cart, 'p-wf', 32, companyCap)
  assert.deepEqual(money(cart), { count: 2, total: 64 })
  cart = addProductToCart(cart, 'p-mt', 55, companyCap)
  assert.deepEqual(money(cart), { count: 3, total: 119 })
  assert.equal(cart.length, 2)
})

test('quantity increase and decrease work on the same cart state', () => {
  let cart = addProductToCart([], 'p-wf', 32, companyCap)
  cart = setCartQty(cart, 'p-wf', 4, companyCap)
  assert.deepEqual(money(cart), { count: 4, total: 128 })
  cart = setCartQty(cart, 'p-wf', 3, companyCap)
  assert.deepEqual(money(cart), { count: 3, total: 96 })
})

test('quantity zero removes the line', () => {
  let cart = addProductToCart([], 'p-wf', 32, companyCap)
  cart = addProductToCart(cart, 'p-mt', 55, companyCap)
  cart = setCartQty(cart, 'p-wf', 0, companyCap)
  assert.equal(cart.some((line) => line.productId === 'p-wf'), false)
  assert.deepEqual(money(cart), { count: 1, total: 55 })
  cart = setCartQty(cart, 'p-mt', 0, companyCap)
  assert.deepEqual(cart, [])
  assert.deepEqual(money(cart), { count: 0, total: 0 })
})

test('SKU and barcode search remain functional', () => {
  const product = { name: 'Waffle Premix', sku: 'WF001', barcode: '9550001000049' }
  assert.equal(productMatchesQuery(product, ''), true)
  assert.equal(productMatchesQuery(product, 'WF001'), true)
  assert.equal(productMatchesQuery(product, 'wf001'), true)
  assert.equal(productMatchesQuery(product, '9550001000049'), true)
  assert.equal(productMatchesQuery(product, 'waffle'), true)
  assert.equal(productMatchesQuery(product, 'MT001'), false)
  assert.equal(posPage.includes('productMatchesQuery(p, query)'), true)
  assert.equal(posPage.includes('Search name, SKU or barcode'), true)
})

test('company POS does not cap quantity on the card; agent POS does', () => {
  const overCompany = addProductToCart(
    [{ productId: 'p-wf', qty: 2, price: 32 }],
    'p-wf',
    32,
    { capToAvailable: false, available: 2 },
  )
  assert.equal(overCompany[0]?.qty, 3)

  const blockedAdd = addProductToCart(
    [{ productId: 'p-wf', qty: 2, price: 32 }],
    'p-wf',
    32,
    agentCap,
  )
  assert.equal(blockedAdd[0]?.qty, 2)

  const capped = setCartQty([{ productId: 'p-wf', qty: 1, price: 32 }], 'p-wf', 9, agentCap)
  assert.equal(capped[0]?.qty, 2)

  const unstocked = addProductToCart([], 'p-wf', 32, { capToAvailable: true, available: 0 })
  assert.deepEqual(unstocked, [])

  assert.equal(posPage.includes('capToAvailable: Boolean(linkedAgent)'), true)
  assert.equal(posPage.includes("toast('Insufficient stock'"), false)
  assert.equal(dbSrc.includes("toast('Insufficient stock'"), true)
})

test('agent minimum price validation stays in PosPage and is not simplified', () => {
  assert.equal(posPage.includes('configuredAgentPrice'), true)
  assert.equal(posPage.includes('belowAgentPriceMessage'), true)
  assert.equal(posPage.includes('agentPriceViolation'), true)
  assert.equal(posPage.includes('disabled={!cart.length || agentPriceViolation || submitting}'), true)
})

test('payment methods remain controlled by existing settings', () => {
  assert.equal(posPage.includes('enabledPaymentMethods'), true)
  assert.equal(posPage.includes("(['cash', 'bank_transfer', 'duitnow', 'card'] as PaymentMethod[])"), true)
})

test('discount permission remains unchanged', () => {
  assert.equal(posPage.includes('disabled={!state.settings.allowDiscount}'), true)
  assert.equal(posPage.includes('!linkedAgent &&'), true)
})

test('empty cart cannot complete a sale', () => {
  assert.equal(posPage.includes('disabled={!cart.length || agentPriceViolation || submitting}'), true)
  assert.equal(dbSrc.includes("toast('Cart is empty'"), true)
})

test('repeated Complete Sale clicks cannot submit duplicate sales', () => {
  const lock = { current: false }
  assert.equal(beginPosSubmit(lock), true)
  assert.equal(beginPosSubmit(lock), false)
  assert.equal(beginPosSubmit(lock), false)
  endPosSubmit(lock)
  assert.equal(beginPosSubmit(lock), true)
  endPosSubmit(lock)
  assert.equal(posPage.includes('beginPosSubmit(submittingRef)'), true)
  assert.equal(posPage.includes('endPosSubmit(submittingRef)'), true)
  assert.equal(posPage.includes('submitting'), true)
})

test('successful sale still returns the invoice number and clears the cart', () => {
  assert.equal(posPage.includes('setCompleted(sale)'), true)
  assert.equal(posPage.includes('setCart([])'), true)
  assert.equal(posPage.includes('completed.invoiceNo'), true)
  assert.equal(posPage.includes('Sale completed'), true)
})

test('Company POS still calls createSale and Agent POS still calls createAgentSale', () => {
  assert.equal(posPage.includes('api.createSale({'), true)
  assert.equal(posPage.includes('api.createAgentSale({'), true)
  assert.equal(posPage.includes('linkedAgent'), true)
  assert.equal(posPage.includes('paidAmount: total'), true)
  assert.equal(posPage.includes('sellingPrice: line.price'), true)
})

test('layout, sticky cart summary, safe-area, and ProductMark stay POS-only UX', () => {
  assert.equal(posPage.includes('data-pos-mobile-summary'), true)
  assert.equal(posPage.includes('View cart'), true)
  assert.equal(posPage.includes('safe-area-inset-bottom'), true)
  assert.equal(posPage.includes('pb-[calc(8.75rem+env(safe-area-inset-bottom))]'), true)
  assert.equal(posPage.includes('md:grid-cols-3'), true)
  assert.equal(posPage.includes('lg:grid-cols-[minmax(0,1fr)_24rem]'), true)
  assert.equal(posPage.includes('size="xl"'), true)
  assert.equal(productMark.includes("'xl'"), true)
  assert.equal(posPage.includes('data-pos-qty-control'), true)
  assert.equal(posPage.includes('Complete sale'), true)
  assert.equal(posPage.includes('lg:hidden'), true)
  assert.equal(posPage.includes('hidden') && posPage.includes('lg:sticky'), true)
})

test('mobile product grid is constrained to the viewport and does not rely on implicit auto columns', () => {
  assert.equal(posPage.includes('grid min-w-0 max-w-full grid-cols-1'), true)
  assert.equal(posPage.includes('overflow-x-clip'), true)
  assert.equal(posPage.includes('grid min-w-0 grid-cols-2'), true)
  assert.equal(posPage.includes('sf-card flex min-w-0 flex-col overflow-hidden'), true)
  assert.equal(posPage.includes('compact'), true)
  assert.equal(posPage.includes('max-w-full overflow-hidden border-t'), true)
  assert.equal(posPage.includes('width="max-w-full sm:max-w-lg"'), true)
  assert.equal(posPage.includes('h-12 w-full min-w-0'), true)
  assert.equal(posPage.includes('hover:-translate-y-0.5'), false)
})

test('card quantity controls reuse the same cart mutation helpers and one cart state', () => {
  assert.equal(posPage.includes('useState<CartLine[]>([])'), true)
  assert.equal(posPage.includes('addProductToCart'), true)
  assert.equal(posPage.includes('setCartQty'), true)
  assert.equal((posPage.match(/useState<CartLine\[\]>/g) ?? []).length, 1)
  assert.equal(posPage.includes('localStorage'), false)
  assert.equal(posCart.includes('localStorage'), false)
  assert.equal(posPage.includes('queueSalesWrite'), false)
  assert.equal(posPage.includes('recipePhoto'), false)
  assert.equal(posPage.includes('imageUrl'), false)
  assert.equal(posPage.includes('Drive'), false)
})
