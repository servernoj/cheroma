import express from 'express'
import * as tools from '@/tools/index.js'

const router = express.Router()

router.post(
  '/restart',
  async (req, res) => {
    tools.system.requestRestart()
    res.sendStatus(200)
  }
)


export default router