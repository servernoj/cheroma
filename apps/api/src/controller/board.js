import express from 'express'
import * as board from '@/modules/board.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'
import { sleep } from '@/modules/utils.js'

const router = express.Router()

router.post(
  '/grab',
  async (req, res) => {
    await board.grab()
    res.sendStatus(200)
  }
)

router.post(
  '/release',
  async (req, res) => {
    await board.release()
    res.sendStatus(200)
  }
)

router.post(
  '/to',
  validator({
    body: z.object({
      to: z.string(),
      height: z.number().int().nonnegative().default(0)
    })
  }),
  async (req, res) => {
    const { to, height } = res.locals.parsed.body
    const { x, y, z } = board.notationToPosition(to)
    await board.home()
    await sleep(1000)
    await board.descent({
      x,
      y,
      z: z + height
    }, { delay: 2000, vMaxDegPerSec: 30 })
    res.sendStatus(200)
  }
)

router.post(
  '/move',
  validator({
    body: z.object({
      from: z.string(),
      to: z.string(),
      piece: z.enum(board.pieces)
    })
  }),
  async (req, res) => {
    const { from, to, piece } = res.locals.parsed.body
    await board.move({ from, to, piece })
    res.sendStatus(200)
  }
)


export default router