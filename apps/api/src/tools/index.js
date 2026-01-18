import i2c from '@/i2c-stub.js'

const deviceAddr = 0x40

/**
 * Sleep for specified number of milliseconds
 * @param {number} ms Sleep time
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(
  resolve => {
    const timer = setTimeout(
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      ms
    )
  }
)

/**
 * Write to an I2C register
 * @param {number} regAddr Register address (0x00-0xFF)
 * @param {Buffer} data Data to write (Buffer or array of bytes)
 * @returns {Promise<void>}
 */
const writeRegister = async (regAddr, data) => {
  const bus = await i2c.openPromisified(1)
  const buffer = Buffer.from([
    regAddr,
    ...(data ?? Buffer.from([0xFF]))
  ])
  await bus.i2cWrite(deviceAddr, buffer.length, buffer)
  await bus.close()
}

/**
 * 
 * @param {{
 *   array: Array<any>
 *   handler: (args: any) => Promise<void>
 *   bulkSize: number
 *   bulkHandler?: (args: Array<any>) => Promise<void>
 * }} args 
 * @returns 
 */
const throttler = (
  {
    array,
    handler,
    bulkHandler,
    bulkSize = 10
  }) => {
  const numGroups = Math.ceil(array.length / bulkSize)
  const groups = Array(numGroups).fill([]).map((_, index) => {
    const start = index * bulkSize
    const end = start + bulkSize
    return array.slice(start, end)
  })
  const bulkHandlerMultiplexed = bulkHandler || ((g) => Promise.all(g.map(handler)))
  return groups.reduce(
    (p, g) => p.then(
      prev => bulkHandlerMultiplexed(g).then(current => [...prev, ...current])
    ),
    Promise.resolve([])
  )
}


export {
  sleep,
  writeRegister,
  throttler
}