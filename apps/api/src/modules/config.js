import savedConfig from '@/config.json' with {type: 'json'}
import { merge, cloneDeep } from 'lodash-es'
import { writeFile } from 'node:fs/promises'

const listeners = new Set()
let config = cloneDeep(savedConfig)

/**
 * Subscribe handler for config object updates
 * @param {*} listener 
 * @param {{immediate: boolean}} [options] 
 * @returns 
 */
const subscribe = (listener, options) => {
  const {
    immediate = true
  } = options ?? {}
  listeners.add(listener)
  if (immediate) listener(config)
  return () => listeners.delete(listener)
}

const emit = () => {
  for (const listener of listeners) {
    listener(config)
  }
}

const update = data => {
  config = merge(cloneDeep(config), data)
  emit()
  return config
}
const retrieve = () => config

const reset = () => {
  config = cloneDeep(savedConfig)
  emit()
  return config
}

const save = async () => {
  const configUrl = new URL('../config.json', import.meta.url)
  await writeFile(configUrl, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return config
}

export {
  subscribe,
  update,
  retrieve,
  reset,
  save
}

export default retrieve