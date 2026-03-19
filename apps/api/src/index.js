import { register } from 'node:module'
import { Worker } from 'node:worker_threads'

register('esm-module-alias/loader', import.meta.url)

const init = async () => {
  const worker = new Worker(
    new URL('./worker.js', import.meta.url),
    { name: 'chess.com' }
  )
  const { moveProcessorFactory, init } = await import('@/modules/live.js')
  const moveProcessor = moveProcessorFactory(worker)

  worker.on('message', (msg) => {
    if (msg.type === 'move') {
      moveProcessor(msg)
    } else if (msg.type === 'abort') {
      init()
      worker.postMessage({ type: 'stop' })
    }
  })
  const serverInit = await import('./server.js')
  await serverInit.default(worker)
}

init()