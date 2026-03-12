import i2c from '@/i2c-stub.js'

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

/**
 * @param {Array<Array<number>>} A 
 * @param {Array<Array<number>>} B
 * @returns {Array<Array<number>>}
 */
const mMult = (A, B) => {
  if (
    !Array.isArray(A) ||
    !A.every(
      row => (
        Array.isArray(row) &&
        A[0].length === row.length
      )
    ) ||
    !Array.isArray(B) ||
    !B.every(
      row => (
        Array.isArray(row) &&
        B[0].length === row.length
      )
    ) ||
    A[0].length !== B.length
  ) {
    throw new Error('Invalid dimensions')
  }
  // A: M x N, B: N x K
  const M = A.length
  const N = A[0].length
  const K = B[0].length
  const C = []
  for (let i = 0; i < M; i++) {
    const c = []
    for (let j = 0; j < K; j++) {
      let sum = 0
      for (let p = 0; p < N; p++) {
        sum += A[i][p] * B[p][j]
      }
      c.push(sum)
    }
    C.push(c)
  }
  return C
}

/**
 * @param {Array<Array<number>>} A 
 * @param {Array<Array<number>>} B
 * @param {(x:number, y:number) => number} op
 * @returns {Array<Array<number>>}
 */
const mOp = (A, B, op) => {
  if (
    !Array.isArray(A) ||
    !A.every(
      row => (
        Array.isArray(row) &&
        A[0].length === row.length
      )
    ) ||
    !Array.isArray(B) ||
    !B.every(
      row => (
        Array.isArray(row) &&
        B[0].length === row.length
      )
    ) ||
    A.length !== B.length ||
    A[0].length !== B[0].length
  ) {
    throw new Error('Invalid dimensions')
  }
  const M = A.length
  const N = A[0].length
  const C = []
  for (let i = 0; i < M; i++) {
    const c = []
    for (let j = 0; j < N; j++) {
      c.push(op(A[i][j], B[i][j]))
    }
    C.push(c)
  }
  return C
}

/**
 * 
 * @param {Array<Array<number>>} A 
 * @returns {Array<Array<number>>} 
 */
const mTrans = (A) => {
  if (
    !Array.isArray(A) ||
    !A.every(
      row => (
        Array.isArray(row) &&
        A[0].length === row.length
      )
    )
  ) {
    throw new Error('Invalid dimensions')
  }
  const M = A.length
  const N = A[0].length
  const C = []
  for (let j = 0; j < N; j++) {
    const c = []
    for (let i = 0; i < M; i++) {
      c.push(A[i][j])
    }
    C.push(c)
  }
  return C
}

const toBinary = (byte) => '0b' + (byte >>> 0).toString(2).padStart(8, '0')

export {
  mMult,
  mTrans,
  mOp,
  sleep,
  writeRegister,
  readRegister,
  throttler,
  closeBus,
  toBinary
}