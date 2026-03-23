import * as board from '@/modules/board.js'
import { pick } from 'lodash-es'
import { Chess } from 'chess.js'

const chess = new Chess()

/**
 * @param {import('chess.js').Move} move 
 * @returns {Array<{fn: string, args: Array<any>}>}
 */
const moveToArmActions = (move) => {
  const result = []
  if (move.isCapture()) {
    // TODO: add special handling for promotions
    result.push({
      fn: 'remove',
      args: [{
        from: move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to,
        piece: move.captured
      }]
    })
  } else if (move.isKingsideCastle()) {
    result.push({
      fn: 'move',
      args: [{
        ...(
          move.color === 'w'
            ? { from: 'h1', to: 'f1' }
            : { from: 'h8', to: 'f8' }
        ),
        piece: 'r'
      }]
    })
  } else if (move.isQueensideCastle()) {
    result.push({
      fn: 'move',
      args: [{
        ...(
          move.color === 'w'
            ? { from: 'a1', to: 'd1' }
            : { from: 'a8', to: 'd8' }
        ),
        piece: 'r'
      }]
    })
  }

  result.push({
    fn: 'move',
    args: [{
      from: move.from,
      to: move.to,
      piece: move.piece
    }]
  })
  return result
}

const handleMove = async (move) => {
  const m = chess.move(move)
  console.log(pick(m, ['from', 'to', 'piece', 'color']))
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
  // -- Shake the room
  const armActions = moveToArmActions(m)
  for (const action of armActions) {
    if (typeof board[action.fn] === 'function') {
      await board[action.fn](action.args)
    }
  }
  return chess.isGameOver()
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