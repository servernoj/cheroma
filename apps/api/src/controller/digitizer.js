import express from 'express'
import * as digitizer from '@/modules/digitizer.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.get(
  '/test',
  validator({
    query: z.object({
      timeoutSec: z.number().positive().finite()
    })
  }),
  async (req, res) => {
    const { timeoutSec } = res.locals.parsed.query
    const data = await digitizer.runPollUntilInterrupt(timeoutSec)
    if (data === null) {
      res.status(408).json({
        error: 'Timeout',
        message: `No interrupt within ${timeoutSec}s`
      })
      return
    }
    res.json(data)
  }
)

export default router
