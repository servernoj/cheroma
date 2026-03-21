import i2c from '@/i2c-stub.js'

/**
 * Helper to reduce i2c bus opening overhead
 */
let busPromise = null
const getBus = () => {
  if (!busPromise) {
    busPromise = i2c.openPromisified(1)
  }
  return busPromise
}

/**
 * Write to an I2C register
 * @param {number} regAddr Register address (0x00-0xFF)
 * @param {Buffer|number[]} data Data to write (Buffer or array of bytes)
 * @param {number} deviceAddr I2C device address (e.g. 0x40 for PCA9685)
 * @returns {Promise<void>}
 */
const writeRegister = async (regAddr, data, deviceAddr) => {
  const bus = await getBus()
  const buffer = Buffer.from([
    regAddr,
    ...(data ?? Buffer.from([0xFF]))
  ])
  await bus.i2cWrite(deviceAddr, buffer.length, buffer)
}

/**
 * Read from an I2C register (sets register pointer then reads)
 * @param {number} regAddr Register address (0x00-0xFF)
 * @param {number} byteLength Number of bytes to read
 * @param {number} deviceAddr I2C device address
 * @returns {Promise<Buffer>}
 */
const readRegister = async (regAddr, byteLength, deviceAddr) => {
  const bus = await getBus()
  await bus.i2cWrite(deviceAddr, 1, Buffer.from([regAddr]))
  const buf = Buffer.alloc(byteLength)
  await bus.i2cRead(deviceAddr, byteLength, buf)
  return buf
}

/**
 * Close i2c bus handler
 */
const closeBus = async () => {
  if (busPromise) {
    const bus = await busPromise
    busPromise = null
    await bus.close()
  }
}

export {
  writeRegister,
  readRegister,
  closeBus,
}