import express from 'express'
import * as board from '@/modules/board.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

const pieceSchema = z.enum(['p', 'b', 'n', 'r', 'k', 'q'])

router.post(
  '/to',
  validator({
    body: z.object({
      target: z.string(),
      height: z.number().int().nonnegative().default(0)
    })
  }),
  async (req, res) => {
    const { target, height } = res.locals.parsed.body
    board.to(target, height)
    res.sendStatus(200)
  }
)

router.post(
  '/move',
  validator({
    body: z.object({
      from: z.string(),
      to: z.string(),
      piece: pieceSchema
    })
  }),
  async (req, res) => {
    const { from, to, piece } = res.locals.parsed.body
    await board.move({ from, to, piece })
    res.sendStatus(200)
  }
)

router.post(
  '/remove',
  validator({
    body: z.object({
      from: z.string(),
      piece: pieceSchema
    })
  }),
  async (req, res) => {
    const { from, piece } = res.locals.parsed.body
    await board.remove({ from, piece })
    res.sendStatus(200)
  }
)


export default router