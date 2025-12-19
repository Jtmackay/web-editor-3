const path = require('path')
const crypto = require('crypto')
const { FTPService } = require('../electron/services/ftpService.cjs')
const { DatabaseService } = require('../electron/services/databaseService.cjs')

function md5(s) {
  return crypto.createHash('md5').update(String(s || ''), 'utf-8').digest('hex')
}

function normalizeRemote(p) {
  let out = String(p || '/').replace(/\\/g, '/')
  if (!out.startsWith('/')) out = '/' + out
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

async function run() {
  const host = process.env.FTP_HOST
  const port = Number(process.env.FTP_PORT || 21)
  const username = process.env.FTP_USER
  const password = process.env.FTP_PASS
  const defaultPath = process.env.FTP_DEFAULT_PATH || '/'
  const remotePathEnv = process.env.FTP_REMOTE_PATH
  const remotePath = normalizeRemote(remotePathEnv || path.posix.join(defaultPath || '/', 'test.html'))

  if (!host || !username || !password) {
    console.error('Missing FTP credentials. Set FTP_HOST, FTP_USER, FTP_PASS, optionally FTP_PORT, FTP_DEFAULT_PATH, FTP_REMOTE_PATH.')
    process.exit(2)
  }

  const ftp = new FTPService()
  const db = new DatabaseService()

  const log = (msg) => console.log(`[drift-verify] ${msg}`)

  try {
    log(`Connecting to FTP ${host}:${port} user=${username}`)
    await ftp.connect({ host, port, username, password, defaultPath })
    log(`Connected. Using remote path: ${remotePath}`)

    log('Purging local database versions/history to simulate a clean baseline')
    try { await db.clearAllFileHistory() } catch {}
    try { await db.clearAllFileVersions() } catch {}

    log('Stage 1: Ensure baseline is empty file')
    await ftp.uploadFile('', remotePath)
    const baselineContent = await ftp.downloadFile(remotePath, null)
    const baselineHash = md5(baselineContent)
    if (baselineContent !== '') {
      console.error('Expected empty baseline content')
      process.exit(1)
    }
    await db.addFileVersion(null, remotePath, null, baselineContent, baselineHash, 'baseline', null)
    await db.addFileHistory(null, remotePath, null, 'baseline', baselineHash, 'Initial baseline scan')
    log(`Baseline recorded: hash=${baselineHash}`)

    log('Stage 2: Apply change "11:35" and record quick drift result')
    await ftp.uploadFile('11:35', remotePath)
    const changedContent = await ftp.downloadFile(remotePath, null)
    const changedHash = md5(changedContent)
    const latest = await db.getLatestFileVersion(null, remotePath)
    if (!latest || latest.content_hash !== baselineHash) {
      console.error('Latest baseline not found or hash mismatch before drift apply')
      process.exit(1)
    }
    if (changedHash !== latest.content_hash) {
      await db.addFileVersion(null, remotePath, null, changedContent, changedHash, 'external_change', latest.id)
      await db.addFileHistory(null, remotePath, null, 'external_change', changedHash, 'Detected drift')
      log(`Drift recorded: hash=${changedHash}`)
    } else {
      console.error('No drift detected; content hash equals baseline unexpectedly')
      process.exit(1)
    }

    log('Stage 3: Verify versions and history')
    const versions = await db.getFileVersions(null, remotePath, 10)
    const history = await db.getFileHistory(null, remotePath, 10)

    const okVersions =
      Array.isArray(versions) &&
      versions.length >= 2 &&
      versions[0].action === 'external_change' &&
      versions[0].content === '11:35' &&
      versions[1].action === 'baseline' &&
      versions[1].content === ''

    if (!okVersions) {
      console.error('Version check failed. Expected [external_change "11:35", baseline ""].')
      console.error('Versions:', versions)
      process.exit(1)
    }

    const okHistory =
      Array.isArray(history) &&
      history.length >= 2 &&
      history[0].action === 'external_change' &&
      history[1].action === 'baseline'

    if (!okHistory) {
      console.error('History check failed. Expected entries in order [external_change, baseline].')
      console.error('History:', history)
      process.exit(1)
    }

    log('SUCCESS: Baseline and drift behave as expected')
    process.exit(0)
  } catch (err) {
    console.error('Test failed with error:', err && err.message ? err.message : err)
    process.exit(1)
  } finally {
    try { await ftp.disconnect() } catch {}
  }
}

run()
