import express from 'express'
import morgan from 'morgan'
import { queryTypes, fallback, errorHandler } from '@/controller/mw/index.js'
import servo from '@/controller/servo.js'
import arm from '@/controller/arm.js'
import board from '@/controller/board.js'
import digitizer from '@/controller/digitizer.js'
import calibration from '@/controller/calibration.js'
import { init as pca9685Init } from '@/modules/drivers/PCA9685.js'
import { init as mcp23017Init } from '@/modules/drivers/MCP23017.js'
import * as gpio from '@/modules/drivers/gpio.js'
import { getPosition, toPoint } from '@/modules/servo.js'
import { closeBus } from '@/modules/utils.js'

export default async () => {
  const app = express()

  app.use(morgan('dev'))
  app.use(express.json(), queryTypes)

  app.get('/health', (req, res) => res.sendStatus(200))
  app.use('/servo', servo)
  app.use('/arm', arm)
  app.use('/board', board)
  app.use('/digitizer', digitizer)
  app.use('/calibration', calibration)

  app.use(fallback)
  app.use(errorHandler)

  app.listen(3000, async () => {
    console.log('Server started')
    await pca9685Init()
    await mcp23017Init()
    gpio.startWatch()
  })
  const getShutdownHandler = (signal) => {
    const handler = async () => {
      process.off(signal, handler)
      console.warn(`Acting upon '${signal}' signal...`)
      gpio.stopWatch()
      await toPoint(getPosition('init'), [], { relax: true })
      await closeBus()
      process.kill(process.pid, signal)
    }
    return handler
  }
  process.on('SIGINT', getShutdownHandler('SIGINT'))
  process.on('SIGTERM', getShutdownHandler('SIGTERM'))
}

