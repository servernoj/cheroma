import i2c from '@/i2c-stub.js'

const deviceAddr = 0x42

/**
 * Read from an I2C register using FSM-based two-phase protocol
 * @param {number} regAddr Register address (0x00-0xFF)
 * @returns {Promise<Buffer>} Buffer containing the read data
 */
export const readRegister = async (regAddr) => {
  const bus = await i2c.openPromisified(1)

  // Step 1: Write register address
  const cmdBuffer = Buffer.from([regAddr])
  await bus.i2cWrite(deviceAddr, cmdBuffer.length, cmdBuffer)

  // Step 2: Read length byte
  const lenBuffer = Buffer.alloc(1)
  await bus.i2cRead(deviceAddr, 1, lenBuffer)
  const dataLen = lenBuffer[0]

  // Step 3: Read actual data
  const dataBuffer = Buffer.alloc(dataLen)
  await bus.i2cRead(deviceAddr, dataLen, dataBuffer)

  await bus.close()
  return dataBuffer
}

/**
 * Write to an I2C register
 * @param {number} regAddr Register address (0x00-0xFF)
 * @param {Buffer} data Data to write (Buffer or array of bytes)
 * @returns {Promise<void>}
 */
export const writeRegister = async (regAddr, data) => {
  const bus = await i2c.openPromisified(1)
  const buffer = Buffer.from([
    regAddr,
    ...(data ?? Buffer.from([0xFF]))
  ])
  await bus.i2cWrite(deviceAddr, buffer.length, buffer)
  await bus.close()
}
