import { register } from 'node:module'

const init = async () => {
  register('esm-module-alias/loader', import.meta.url)
  const serverInit = await import('./server.js')
  await serverInit.default()
}

init()