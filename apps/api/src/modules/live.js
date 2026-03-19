import { sleep } from '@/modules/utils.js'
import { Chess } from 'chess.js'

const chess = new Chess()

const handleMove = async (move) => {
  const m = chess.move(move)

  console.log({ move, m })
  if (m.isCapture()) {
    console.log(`capture of ${m.captured}`)
  } else if (m.isEnPassant()) {
    console.log(`en-passant capture of ${m.captured}`)
  }
  if (m.isPromotion()) {
    console.log(`promotion to ${m.promotion}`)
  }
  if (m.isKingsideCastle()) {
    console.log('O-O')
  }
  if (m.isQueensideCastle()) {
    console.log('O-O-O')
  }
  if (chess.isCheck()) {
    console.log('in check')
  }

  if (chess.isDraw()) {
    if (chess.isStalemate()) {
      console.log('draw by stalemate')
    } else if (chess.isDrawByFiftyMoves()) {
      console.log('draw by fifty moves')
    } else if (chess.isThreefoldRepetition()) {
      console.log('draw by 3-fold repetition')
    } else if (chess.isInsufficientMaterial()) {
      console.log('draw by insufficient material')
    } else {
      console.log('draw')
    }
  }
  if (chess.isGameOver()) {
    return true
  }

  await sleep(500)
  return false
}

const init = () => {
  chess.reset()
  console.log('Board initialized for a new game')
}

const moveProcessorFactory = worker => {
  let queue = []
  let processing = false
  return async (msg) => {
    queue.push(msg)
    if (processing) return
    processing = true
    try {
      while (queue.length) {
        const item = queue[0]
        let attempts = 0
        while (true) {
          try {
            const gameOver = await handleMove(item.move)
            if (gameOver) {
              queue = []
              processing = false
              worker.postMessage({ type: 'stop' })
              break
            }
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
}

export {
  init,
  moveProcessorFactory
}