import config from '@/config.json' with {type: 'json'}

declare global {
  type SetChannel = {
    channel: number
    pulseWidthUs: number
  }
  type KinematicsInput = {
    q0: number
    q1: number
    q2: number
    q3: number
  }
  type KinematicsOutput = {
    x: number
    y: number
    z: number
  }
  // --
  type ServoCalPoint = [number, number]
  type ServoName = keyof typeof config['servos']
  type ServoData = {
    [name in ServoName]: {
      channel: number
      home: number
      calPoints: Array<ServoCalPoint>
    }
  }
  type ServoPosition = {
    [name in ServoName]: number | null
  }
  // --
  type SegmentName = keyof typeof config['segments']
  type SegmentData = {
    [name in SegmentName]: {
      length: number
    }
  }
  type Config = {
    units: {
      pulse: 'us'
      angle: 'deg'
      length: 'mm'
    }
    servos: ServoData
    segments: SegmentData
  }
}

export { };