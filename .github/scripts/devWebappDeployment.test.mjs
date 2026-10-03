import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  claspPublishArgs,
  decideDeployment,
  publishDevWebapp,
  versionDescription,
} from './devWebappDeployment.mjs'

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function fakeRun(handlers) {
  const calls = []
  return {
    calls,
    run(args) {
      calls.push(args)
      const command = args.find((arg) => !arg.startsWith('-'))
      const handler = handlers[command]
      if (!handler) throw new Error(`unexpected clasp command ${command}`)
      return Promise.resolve(JSON.stringify(handler(args)))
    },
  }
}

test('version description contains the exact git sha and is not the version number', () => {
  const description = versionDescription(SHA)
  assert.equal(description, `git:${SHA}`)
  assert.equal(description.includes(SHA), true)
  assert.notEqual(description, SHA)
  assert.throws(() => versionDescription('5be0a70'), /40-character/)
})

test('first run creates one deployment when none exists', async () => {
  const fake = fakeRun({
    'list-deployments': () => [],
    'create-version': () => ({ versionNumber: 4 }),
    'list-versions': () => [{ versionNumber: 4, description: `git:${SHA}` }],
    deploy: () => ({ deploymentId: 'DEVDEPLOYMENT1', versionNumber: 4, description: `git:${SHA}` }),
  })
  const result = await publishDevWebapp({
    gitSha: SHA,
    storedDeploymentId: '',
    run: fake.run,
  })
  assert.equal(result.action, 'create')
  assert.equal(result.deploymentId, 'DEVDEPLOYMENT1')
  assert.equal(result.versionNumber, 4)
  assert.equal(result.versionDescription, `git:${SHA}`)
  assert.equal(fake.calls.some((args) => args.includes('redeploy')), false)
  assert.equal(fake.calls.filter((args) => args.includes('deploy')).length, 1)
})

test('next run redeploys the same deployment id', async () => {
  const fake = fakeRun({
    'list-deployments': () => [{ deploymentId: 'DEVDEPLOYMENT1', versionNumber: 4 }],
    'create-version': () => ({ versionNumber: 5 }),
    'list-versions': () => [{ versionNumber: 5, description: `git:${OTHER_SHA}` }],
    redeploy: (args) => ({
      deploymentId: args[2],
      versionNumber: 5,
      description: `git:${OTHER_SHA}`,
    }),
  })
  const result = await publishDevWebapp({
    gitSha: OTHER_SHA,
    storedDeploymentId: 'DEVDEPLOYMENT1',
    run: fake.run,
  })
  assert.equal(result.action, 'redeploy')
  assert.equal(result.deploymentId, 'DEVDEPLOYMENT1')
  assert.deepEqual(
    fake.calls.find((args) => args.includes('redeploy')),
    ['--json', 'redeploy', 'DEVDEPLOYMENT1', '--versionNumber', '5', '--description', `git:${OTHER_SHA}`],
  )
  assert.equal(fake.calls.some((args) => args.includes('deploy')), false)
})

test('a second deployment is refused when the id variable is empty', async () => {
  const fake = fakeRun({
    'list-deployments': () => [{ deploymentId: 'DEVDEPLOYMENT1' }],
  })
  await assert.rejects(
    () => publishDevWebapp({ gitSha: SHA, storedDeploymentId: '  ', run: fake.run }),
    /Refusing to create a second deployment/,
  )
  assert.deepEqual(fake.calls.map((args) => args.find((arg) => !arg.startsWith('-'))), ['list-deployments'])
})

test('a stored id that is not on this project fails closed', async () => {
  const fake = fakeRun({
    'list-deployments': () => [{ deploymentId: 'SOMEOTHERDEPLOYMENT' }],
  })
  await assert.rejects(
    () => publishDevWebapp({
      gitSha: SHA,
      storedDeploymentId: 'DEVDEPLOYMENT1',
      run: fake.run,
    }),
    /not a deployment of this Apps Script project/,
  )
  assert.equal(fake.calls.some((args) => args.includes('deploy') || args.includes('redeploy')), false)
})

test('publish stops when the version description does not contain the sha', async () => {
  const fake = fakeRun({
    'list-deployments': () => [],
    'create-version': () => ({ versionNumber: 6 }),
    'list-versions': () => [{ versionNumber: 6, description: 'no sha here' }],
  })
  await assert.rejects(
    () => publishDevWebapp({ gitSha: SHA, storedDeploymentId: '', run: fake.run }),
    /does not contain the Git commit SHA/,
  )
  assert.equal(fake.calls.some((args) => args.includes('deploy')), false)
})

test('clasp publish args never select create-script or a second bare deploy id', () => {
  const createArgs = claspPublishArgs({
    action: 'create',
    versionNumber: 2,
    description: `git:${SHA}`,
  })
  assert.equal(createArgs.includes('create'), false)
  assert.equal(createArgs.includes('create-script'), false)
  assert.equal(createArgs.includes('deploy'), true)
  const redeployArgs = claspPublishArgs({
    action: 'redeploy',
    versionNumber: 3,
    description: `git:${SHA}`,
    deploymentId: 'DEVDEPLOYMENT1',
  })
  assert.equal(redeployArgs.includes('deploy'), false)
  assert.equal(redeployArgs[2], 'DEVDEPLOYMENT1')
})

test('workflow reads the deployment id as an environment variable, not a secret', () => {
  const workflow = fs.readFileSync(new URL('../workflows/deploy-dev.yml', import.meta.url), 'utf8')
  assert.match(workflow, /vars\.CSP_DEV_WEBAPP_DEPLOYMENT_ID/)
  assert.equal(workflow.includes('secrets.CSP_DEV_WEBAPP_DEPLOYMENT_ID'), false)
  assert.match(workflow, /npx --yes @google\/clasp@3\.4\.1 push --force/)
  assert.match(workflow, /node \.github\/scripts\/devWebappDeployment\.mjs/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /cursor\/module-1-identity-settings-d9ac/)
  assert.match(workflow, /contents: read/)
  assert.equal(workflow.includes('clasp create'), false)
  assert.equal(workflow.includes('create-script'), false)
})

test('decideDeployment treats whitespace as no stored id', () => {
  assert.equal(decideDeployment({ storedDeploymentId: '', deployments: [] }).action, 'create')
  assert.throws(
    () => decideDeployment({ storedDeploymentId: '', deployments: [{ deploymentId: 'DEVDEPLOYMENT1' }] }),
    /second deployment/,
  )
})
