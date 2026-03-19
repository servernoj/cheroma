import { register } from 'node:module'
import { Worker } from 'node:worker_threads'

const init = async () => {
  register('esm-module-alias/loader', import.meta.url)
  const worker = new Worker(
    new URL('./worker.js', import.meta.url),
    { name: 'chess.com' }
  )
  let queue = []
  let processing = false
  async function processNext() {
    if (processing) return
    processing = true
    try {
      while (queue.length) {
        const item = queue[0]
        let attempts = 0
        while (true) {
          try {
            console.log({ move: item.move })
            worker.postMessage({ type: 'ack', seq: item.seq })
            queue.shift()
            break
          } catch (e) {
            attempts++
            if (attempts > 3) {
              throw e
            }
          }
        }
      }
    } finally {
      processing = false
    }
  }
  worker.on('message', (msg) => {
    if (msg.type === 'move') {
      queue.push(msg)
      processNext()
    }
  })
  const serverInit = await import('./server.js')

  await serverInit.default(worker)
}

init()