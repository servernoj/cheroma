import express from 'express'
import * as tools from '@/tools/index.js'
import { validator } from '@/controller/mw/index.js'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import z from 'zod'
import mime from 'mime'

const router = express.Router()

router.get(
  '/info',
  async (req, res) => {
    const info = await tools.firmware.getInfo()
    res.json(info)
  }
)

router.get(
  '/:file',
  validator({
    params: z.object({
      file: z.enum(['halo.bin'])
    })
  }),
  async (req, res) => {
    const { file } = res.locals.parsed.params
    const path = fileURLToPath(new URL(`../../../../esp32c6/build/${file}`, import.meta.url))
    const data = await fs.readFile(path)
    res.setHeader('Content-Type', mime.getType(path) || 'application/octet-stream')
    res.send(data)
  }
)



export default router