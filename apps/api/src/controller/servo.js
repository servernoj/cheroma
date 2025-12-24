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
  '/:channel/:ms',
  validator({
    params: z.object({
      channel: z.number().int().max(5),
      ms: z.number().int()
    })
  }),
  async (req, res) => {
    const { channel, ms: pulseWidthMs } = res.locals.parsed.params
    await servo.setChannel({ channel, pulseWidthMs })
    res.sendStatus(200)
  }
)

export default router