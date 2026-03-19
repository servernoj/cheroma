import { register } from 'node:module'
import { parentPort } from 'node:worker_threads'
import tcn from '@savi2w/chess-tcn'

register('esm-module-alias/loader', import.meta.url)

const init = async () => {

  const PLAY_GAMES_BASE = 'https://www.chess.com/service/play/games'
  const SITE_ORIGIN = 'https://www.chess.com'
  let credits = 0
  let lastIndexSent = 0
  let gameId

  const { sleep } = await import('@/modules/utils.js')

  const getMoves = async (gameId) => {
    const metaRes = await fetch(`${PLAY_GAMES_BASE}/${gameId}`, {
      headers: { Accept: 'application/json' }
    })
    if (!metaRes.ok) {
      /** @type {FetchError} */
      const err = new Error(`Play game meta failed: ${metaRes.status} ${metaRes.statusText}`)
      err.statusCode = metaRes.status
      throw err
    }
    const meta = await metaRes.json()
    const transportPath = meta?.transports?.http?.url ?? meta?.href
    if (!transportPath) throw new Error('No transports.http.url (or href fallback) in play game response')

    const stateUrl = transportPath.startsWith('http') ? transportPath : `${SITE_ORIGIN}${transportPath}`
    const stateRes = await fetch(stateUrl, { headers: { Accept: 'application/json' } })
    if (!stateRes.ok) {
      /** @type {FetchError} */
      const err = new Error(`Play game state failed: ${stateRes.status} ${stateRes.statusText}`)
      err.statusCode = stateRes.status
      throw err
    }
    const state = await stateRes.json()
    const tcnPairs = (state?.moves ?? []).map((m) => m?.[0]).filter(Boolean)
    console.log(state)
    return {
      moves: tcnPairs,
      abort: (
        state?.results?.includes('win') ||
        state?.results?.includes('agreed')
      )
    }
  }

  const pollLoop = async () => {
    while (true) {
      if (!gameId) {
        console.log('Game over!')
        break
      }

      const { moves = [], abort } = await getMoves(gameId).catch(
        e => {
          console.error(e)
          return { moves: undefined, abort: true }
        }
      )
      if (abort) {
        console.log('Game aborted')
        parentPort.postMessage({
          type: 'abort'
        })
        break
      }
      while (lastIndexSent < moves.length && credits > 0) {
        const tcnPair = moves[lastIndexSent]
        const decoded = tcn.decode(tcnPair)
        parentPort.postMessage({
          type: 'move',
          seq: lastIndexSent,
          move: decoded,
        })
        lastIndexSent += 1
        credits -= 1
      }
      await sleep(5000)
    }
  }

  parentPort.on('message', (msg) => {
    if (msg.type === 'start') {
      credits = msg.credits
      gameId = msg.gameId
      lastIndexSent = 0
      void pollLoop()
    } else if (msg.type === 'stop') {
      credits = 0
      gameId = undefined
    } else if (msg.type === 'ack') {
      credits += 1
    }
  })

  console.log('Worker started')

}

init()