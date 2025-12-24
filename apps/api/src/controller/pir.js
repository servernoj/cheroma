import express from 'express'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.post(
  '/config',
  validator({
    body: z.object({
      interval: z.number().int().default(0),
      options: z.object({
        threshold: z.number().int().positive(),
        demoIntervalSec: z.number().positive().int().default(0),
        isEnabled: z.boolean().default(false),
      }).partial()
    })
  }),
  async (req, res) => {
    const { interval, options } = res.locals.parsed.body
    const { worker } = req.app.locals
    worker.postMessage({ result: { interval, options } })
    res.sendStatus(200)
  }
)

export default router