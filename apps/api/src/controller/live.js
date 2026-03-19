import express from 'express'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.post('/start',
  validator({
    body: z.object({
      gameId: z.string()
    })
  }),
  async (req, res) => {
    const { worker } = req.app.locals
    const { gameId } = res.locals.parsed.body
    worker.postMessage({
      type: 'start',
      credits: 5,
      gameId
    })
    res.sendStatus(200)
  }
)

router.post('/stop',
  async (req, res) => {
    const { worker } = req.app.locals
    worker.postMessage({
      type: 'stop'
    })
    res.sendStatus(200)
  }
)

export default router