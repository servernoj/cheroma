import { isMainThread, parentPort } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import handlerFactory from './rpc/simple.js'

if (!isMainThread) {
  const pending = new Map()
  let timer

  const rpcRequest = (req) => new Promise(
    (resolve, reject) => {
      const id = randomUUID()
      const { target, method, args } = req
      pending.set(id, { resolve, reject, req })
      parentPort.postMessage({ id, target, method, args })
    }
  )

  parentPort.on('message', (msg) => {
    const { id, ok, result, error } = msg
    if (id) {
      const entry = pending.get(id)
      if (!entry) {
        return
      }
      pending.delete(id)
      ok
        ? entry.resolve(result)
        : entry.reject(new Error(error))
    } else {
      // -- Reconfiguration request from controller pir/config
      if (timer) {
        clearInterval(timer)
      }
      const { interval, options } = result
      if (interval > 0) {
        console.log(`Polling interval set to ${interval} ms`)
        console.log('Options', options)
        timer = taskLoop(interval, options)
      } else {
        console.log('Polling stopped')
      }
    }
  })

  const taskLoop = (interval, options) => {
    const handler = handlerFactory(rpcRequest, options)
    const timer = setInterval(
      handler,
      interval
    )
    return timer
  }
  console.log('Worker started')
}

export const workerFileName = new URL(import.meta.url)
