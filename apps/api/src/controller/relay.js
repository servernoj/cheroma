import express from 'express'
import * as tools from '@/tools/index.js'

const router = express.Router()

router.post(
  '/',
  async (req, res) => {
    tools.relay.on_off()
    res.sendStatus(200)
  }
)

export default router