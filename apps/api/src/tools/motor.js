import { readRegister, writeRegister } from './i2c-util.js'
import { sleep } from './index.js'

/**
 * @param {Array<{degrees: number, delay: number}>} profile A sequence of motor steps to run in FIXED + COAST mode
 * @param {number} repeat Number of times the profile needs to be repeated, defaults to 1 
 */
export const runProfile = async (profile = [], repeat = 1) => {
  // Each move is bytes (int16 + uint16)
  // Max 15 moves per I2C write (60 bytes)
  const MAX_MOVES_PER_WRITE = 15
  const profile_ = Array(repeat).fill(profile).reduce(
    (acc, p) => [...acc, ...p],
    []
  ).slice(0, 16)
  for (let i = 0; i < profile_.length; i += MAX_MOVES_PER_WRITE) {
    const chunk = profile_.slice(i, i + MAX_MOVES_PER_WRITE)
    const buffer = Buffer.alloc(chunk.length * 4)
    chunk.forEach((move, idx) => {
      buffer.writeInt16LE(move.degrees, idx * 4)
      buffer.writeUInt16LE(move.delay, idx * 4 + 2)
    })
    await writeRegister(0x23, buffer)
    await sleep(2000)
  }
}

/**
 * @param {number} factor Microstepping factor, 1,2,4,..., 128} factor 
 */
export const config = async (factor = 1) => {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(factor)
  await writeRegister(0x20, buffer)
}

export const getConfig = async () => {
  const buffer = await readRegister(0x20)
  return {
    factor: buffer.readUInt16LE()
  }
}

/**
 * @param {number} dir Direction (+1/-1) of the free run
 */
export const freeRun = async (dir = -1) => {
  const dirByte = dir > 0 ? 0x01 : 0xFF
  await writeRegister(0x22, Buffer.from([dirByte]))
}

export const stop = async () => {
  await writeRegister(0x21, null)
}

export const hold = async () => {
  await writeRegister(0x24, null)
}

export const release = async () => {
  await writeRegister(0x25, null)
}
