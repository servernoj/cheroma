import express from 'express'
import * as tools from '@/tools/index.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.post(
  '/',
  validator({
    body: z.object({
      ssid: z.string().min(1),
      password: z.string()
    }).refine(
      (data) => {
        // Validate: ssid.length + password.length + 2 (null terminators) <= 63
        const ssidBytes = Buffer.byteLength(data.ssid, 'utf8')
        const passwordBytes = Buffer.byteLength(data.password, 'utf8')
        return ssidBytes + passwordBytes + 2 <= 63
      },
      {
        message: 'Combined SSID and password too long (max 63 bytes including null terminators)'
      }
    )
  }),
  async (req, res) => {
    const { ssid, password } = res.locals.parsed.body
    await tools.wifi.setCredentials(ssid, password)
    res.sendStatus(200)
  }
)

export default router
