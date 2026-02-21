import express from 'express'
import * as board from '@/modules/board.js'
import * as servo from '@/modules/servo.js'
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
  '/move',
  validator({
    body: z.object({
      from: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number()
      }),
      to: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number()
      })
    })
  }),
  async (req, res) => {
    const { from, to } = res.locals.parsed.body
    await board.descent(from)
    await board.grab()
    await board.search(from, { delta: 5 })
    await sleep(1000)
    await board.lift(from, { liftLength: 50 })
    await board.descent(to, { vMaxDegPerSec: 20, delay: 1000 })
    await sleep(1000)
    await board.release()
    await board.lift(to, { liftLength: 50 })
    await servo.toPoint(servo.getPosition('home'), [], { relax: true })
    res.sendStatus(200)
  }
)

export default router