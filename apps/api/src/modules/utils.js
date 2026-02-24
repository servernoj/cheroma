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
 * @param {Buffer} data Data to write (Buffer or array of bytes)
 * @returns {Promise<void>}
 */
const writeRegister = async (regAddr, data) => {
  const bus = await getBus()
  const buffer = Buffer.from([
    regAddr,
    ...(data ?? Buffer.from([0xFF]))
  ])
  await bus.i2cWrite(deviceAddr, buffer.length, buffer)
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

export {
  mMult,
  mTrans,
  mOp,
  sleep,
  writeRegister,
  throttler,
  closeBus
}