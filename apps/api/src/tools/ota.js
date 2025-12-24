import { readRegister, writeRegister } from './i2c-util.js'

const STATE_NAMES = {
  0: 'UNKNOWN',
  1: 'IDLE',
  2: 'DOWNLOADING',
  3: 'VERIFYING',
  4: 'FLASHING',
  5: 'COMPLETE',
  6: 'ERROR'
}

/**
 * @param {string} url URL for the OTA update firmware file
 */
export const setUrl = async (url = '') => {
  if (
    !url ||
    !/^http[s]?:[/][/]\S+$/i.test(url)
  ) {
    console.error(`Invalid URL ${url}`)
    return
  }
  // Limit URL to 63 bytes (leave room for register address)
  const urlBuffer = Buffer.from(url, 'utf8')
  if (urlBuffer.length > 63) {
    console.error(`URL too long: ${urlBuffer.length} bytes, max 63`)
    return
  }
  await writeRegister(0x10, urlBuffer)
}

export const getUrl = async () => {
  const buffer = await readRegister(0x10)
  return buffer.toString('utf8').split('\0')[0]
}

export const triggerUpdate = async () => {
  await writeRegister(0x11, null)
}

export const getStatus = async () => {
  const statusBuf = await readRegister(0x12)
  const state = statusBuf.readUInt8(0)
  const progress = statusBuf.readUInt8(1)
  const errorCode = statusBuf.readInt32LE(2)
  const bytesDownloaded = statusBuf.readUInt32LE(6)
  const errorFunction = statusBuf.toString('utf8', 10).split('\0')[0]
  return {
    state,
    stateName: STATE_NAMES[state] || 'UNKNOWN',
    progress,
    errorCode,
    bytesDownloaded,
    errorFunction
  }
}

export const resetStatus = async () => {
  await writeRegister(0x13, Buffer.from([0x01]))
}
