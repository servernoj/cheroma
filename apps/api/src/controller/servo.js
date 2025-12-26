import express from 'express'
import * as servo from '@/tools/servo.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.post(
  '/init',
  async (req, res) => {
    await servo.init()
    res.sendStatus(200)
  }
)

router.post(
  '/channel',
  validator({
    body: z.object({
      channel: z.number().int().max(5).min(0),
      ms: z.number().default(0),
      ticks: z.number().int().optional()
    })
  }),
  async (req, res) => {
    const { channel, ms: pulseWidthMs, ticks } = res.locals.parsed.body
    await servo.setChannel({ channel, pulseWidthMs, ticks })
    res.sendStatus(200)
  }
)

export default router