import { register } from 'node:module'

const init = async () => {
  register('esm-module-alias/loader', import.meta.url)
  await import('./server.js')
}

init()