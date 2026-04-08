import express from 'express'
import morgan from 'morgan'
import { queryTypes, fallback, errorHandler } from '@/controller/mw/index.js'
import servo from '@/controller/servo.js'
import arm from '@/controller/arm.js'
import board from '@/controller/board.js'
import digitizer from '@/controller/digitizer.js'
import calibration from '@/controller/calibration.js'
import live from '@/controller/live.js'
import config from '@/controller/config.js'
import { init as pca9685Init } from '@/modules/drivers/PCA9685.js'
import { init as digitizerInit } from '@/modules/drivers/digitizer.js'
import * as gpio from '@/modules/drivers/gpio.js'
import { getPosePosition, toPoint } from '@/modules/servo.js'
import { closeBus } from '@/modules/i2c.js'

export default async (worker) => {
  const app = express()

  app.use(morgan('dev'))
  app.use(express.json(), queryTypes)

  app.get('/health', (req, res) => res.sendStatus(200))
  app.use('/servo', servo)
  app.use('/arm', arm)
  app.use('/board', board)
  app.use('/digitizer', digitizer)
  app.use('/calibration', calibration)
  app.use('/live', live)
  app.use('/config', config)

  app.use(fallback)
  app.use(errorHandler)

  app.listen(3000, async () => {
    console.log('Server started')
    await pca9685Init()
    await digitizerInit()
    gpio.startWatch()
  })
  app.locals.worker = worker
  const getShutdownHandler = (signal) => {
    const handler = async () => {
      process.off(signal, handler)
      console.warn(`Acting upon '${signal}' signal...`)
      gpio.stopWatch()
      await toPoint(getPosePosition('init'), [], { relax: true })
      await closeBus()
      process.kill(process.pid, signal)
    }
    return handler
  }
  process.on('SIGINT', getShutdownHandler('SIGINT'))
  process.on('SIGTERM', getShutdownHandler('SIGTERM'))
}

