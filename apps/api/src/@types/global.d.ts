import { calData } from '@/tools/servo.js'

declare global {
  type SetChannel = {
    channel: number
    pulseWidthUs: number
  }
  type CalPoint = [number, number]
  type ServoName = keyof typeof calData['servos']
  type ServoCalData = {
    [name in ServoName]: {
      channel: number
      home: number
      calPoints: Array<CalPoint>
    }
  }
  type CalData = {
    units: {
      pulse: 'us'
      angle: 'deg'
    }
    servos: ServoCalData
  }
  type ServoPosition = {
    [name in ServoName]: number | null
  }
}

export { };