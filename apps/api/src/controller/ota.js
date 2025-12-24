import express from 'express'
import * as tools from '@/tools/index.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.post(
  '/update',
  async (req, res) => {
    await tools.ota.triggerUpdate()
    res.sendStatus(200)
  }
)

router.post(
  '/url',
  validator({
    body: z.object({
      url: z.string()
    })
  }),
  async (req, res) => {
    const { url } = res.locals.parsed.body
    await tools.ota.setUrl(url)
    res.sendStatus(200)
  }
)

router.get(
  '/url',
  async (req, res) => {
    const url = await tools.ota.getUrl()
    res.json({ url })
  }
)

router.get(
  '/status',
  async (req, res) => {
    const status = await tools.ota.getStatus()
    res.json(status)
  }
)

router.post(
  '/reset',
  async (req, res) => {
    await tools.ota.resetStatus()
    res.sendStatus(200)
  }
)

export default router