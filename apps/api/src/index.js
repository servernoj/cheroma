import { register } from 'node:module'
import { Worker } from 'node:worker_threads'
import { workerFileName } from './worker.js'

const init = async () => {
  register('esm-module-alias/loader', import.meta.url)
  const worker = new Worker(workerFileName, {
    name: 'PIR',
  })
  const { messageProcessor } = await import('./tools/index.js')
  worker.on('message', async (msg) => {
    const { id, target, method, args } = msg
    try {
      const result = await messageProcessor({ target, method, args })
      worker.postMessage({ id, ok: true, result })
    } catch (err) {
      console.error({
        req: { id, target, method, args },
        error: err.message
      })
      worker.postMessage({ id, ok: false, error: err.message })
    }
  })
  const { init: initServer } = await import('./server.js')
  initServer(worker)
}

init()