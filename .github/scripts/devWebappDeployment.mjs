import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CLASP_PACKAGE = '@google/clasp@3.4.1'
const FORBIDDEN_COMMANDS = new Set([
  'create',
  'create-script',
  'delete',
  'delete-script',
  'delete-deployment',
  'undeploy',
])

export function versionDescription(gitSha) {
  if (typeof gitSha !== 'string' || !/^[0-9a-f]{40}$/.test(gitSha)) {
    const error = new Error('Git commit SHA must be the full 40-character commit being deployed.')
    error.code = 'FAIL_CLOSED'
    throw error
  }
  return `git:${gitSha}`
}

export function decideDeployment({ storedDeploymentId, deployments }) {
  if (!Array.isArray(deployments)) {
    const error = new Error('Deployment list was not an array. Refusing to create a deployment.')
    error.code = 'FAIL_CLOSED'
    throw error
  }
  const ids = []
  for (const deployment of deployments) {
    const id = deployment && typeof deployment.deploymentId === 'string'
      ? deployment.deploymentId.trim()
      : ''
    if (!id) {
      const error = new Error('Deployment list contained an entry without a deployment id. Refusing to create a deployment.')
      error.code = 'FAIL_CLOSED'
      throw error
    }
    ids.push(id)
  }
  const stored = typeof storedDeploymentId === 'string' ? storedDeploymentId.trim() : ''
  if (stored) {
    if (!ids.includes(stored)) {
      const error = new Error('CSP_DEV_WEBAPP_DEPLOYMENT_ID is not a deployment of this Apps Script project. Refusing to create another deployment.')
      error.code = 'FAIL_CLOSED'
      throw error
    }
    return { action: 'redeploy', deploymentId: stored }
  }
  if (ids.length > 0) {
    const error = new Error('A DEV deployment already exists but CSP_DEV_WEBAPP_DEPLOYMENT_ID is empty. Refusing to create a second deployment. Set the dev environment variable to the existing deployment id.')
    error.code = 'FAIL_CLOSED'
    throw error
  }
  return { action: 'create' }
}

export function claspPublishArgs({ action, versionNumber, description, deploymentId }) {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    const error = new Error('Apps Script version number is missing. Refusing to deploy.')
    error.code = 'FAIL_CLOSED'
    throw error
  }
  if (!description || !description.startsWith('git:')) {
    const error = new Error('Version description does not contain the Git commit SHA.')
    error.code = 'FAIL_CLOSED'
    throw error
  }
  if (action === 'create') {
    return ['--json', 'deploy', '--versionNumber', String(versionNumber), '--description', description]
  }
  if (action === 'redeploy') {
    if (!deploymentId) {
      const error = new Error('Redeploy requires the stored deployment id.')
      error.code = 'FAIL_CLOSED'
      throw error
    }
    return ['--json', 'redeploy', deploymentId, '--versionNumber', String(versionNumber), '--description', description]
  }
  const error = new Error('Unknown deployment action.')
  error.code = 'FAIL_CLOSED'
  throw error
}

function assertAllowed(args) {
  const command = args.find((arg) => !arg.startsWith('-'))
  if (!command || FORBIDDEN_COMMANDS.has(command)) {
    const error = new Error('Refusing to run a clasp command outside the DEV web-app publish flow.')
    error.code = 'FAIL_CLOSED'
    throw error
  }
}

export async function publishDevWebapp({ gitSha, storedDeploymentId, run }) {
  const description = versionDescription(gitSha)
  const listedText = await run(['--json', 'list-deployments'])
  const listed = JSON.parse(listedText)
  const decision = decideDeployment({ storedDeploymentId, deployments: listed })
  const versionText = await run(['--json', 'create-version', description])
  const version = JSON.parse(versionText)
  const versionNumber = Number(version.versionNumber)
  const versionsText = await run(['--json', 'list-versions'])
  const versions = JSON.parse(versionsText)
  const created = Array.isArray(versions)
    ? versions.find((entry) => Number(entry.versionNumber) === versionNumber)
    : undefined
  if (!created || typeof created.description !== 'string' || !created.description.includes(gitSha)) {
    const error = new Error('The Apps Script version description does not contain the Git commit SHA. Refusing to publish.')
    error.code = 'FAIL_CLOSED'
    throw error
  }
  const publishArgs = claspPublishArgs({
    action: decision.action,
    versionNumber,
    description,
    deploymentId: decision.deploymentId,
  })
  assertAllowed(publishArgs)
  const published = JSON.parse(await run(publishArgs))
  const deploymentId = decision.action === 'create' ? published.deploymentId : decision.deploymentId
  if (!deploymentId || (published.deploymentId && published.deploymentId !== deploymentId)) {
    const error = new Error('The deployment id changed during publish. Refusing to continue.')
    error.code = 'FAIL_CLOSED'
    throw error
  }
  return {
    action: decision.action,
    deploymentId,
    versionNumber,
    versionDescription: description,
  }
}

export function scrubSecrets(text) {
  return String(text || '')
    .replace(/"refresh_token"\s*:\s*"[^"]*"/g, '"refresh_token":"***"')
    .replace(/"client_secret"\s*:\s*"[^"]*"/g, '"client_secret":"***"')
    .replace(/"client_id"\s*:\s*"[^"]*"/g, '"client_id":"***"')
    .replace(/ya29\.[0-9A-Za-z\-_]+/g, '***')
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
}

export function runClasp(args) {
  assertAllowed(args)
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['--yes', CLASP_PACKAGE, ...args], {
      cwd: path.join(repoRoot(), 'apps-script'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      const wrapped = new Error('clasp could not be started.')
      wrapped.code = 'FAIL_CLOSED'
      wrapped.cause = error
      reject(wrapped)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        const wrapped = new Error(`clasp exited ${code}. ${scrubSecrets(stderr)}`.trim())
        wrapped.code = 'FAIL_CLOSED'
        reject(wrapped)
        return
      }
      resolve(stdout.trim())
    })
  })
}

async function main() {
  const result = await publishDevWebapp({
    gitSha: process.env.GITHUB_SHA,
    storedDeploymentId: process.env.CSP_DEV_WEBAPP_DEPLOYMENT_ID,
    run: runClasp,
  })
  const output = {
    ...result,
    deploymentIdVariable: 'CSP_DEV_WEBAPP_DEPLOYMENT_ID',
    deploymentIdIsSecret: false,
  }
  if (result.action === 'create') {
    output.storeDeploymentId = 'Set GitHub Environment dev variable CSP_DEV_WEBAPP_DEPLOYMENT_ID to this deployment id before the next run.'
  }
  const text = `${JSON.stringify(output, null, 2)}\n`
  process.stdout.write(text)
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${scrubSecrets(error && error.message ? error.message : error)}\n`)
    process.exitCode = 1
  })
}
