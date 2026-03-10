declare module '@/gpio-stub.js' {
  type BinaryValue = 0 | 1
  type Direction = 'in' | 'out' | 'high' | 'low'
  type Edge = 'none' | 'rising' | 'falling' | 'both'
  type ValueCallback = (err: Error | null | undefined, value: BinaryValue) => void

  interface GpioOptions {
    debounceTimeout?: number
    activeLow?: boolean
    reconfigureDirection?: boolean
  }

  interface Gpio {
    watch(callback: ValueCallback): void
    unwatchAll(): void
    close(): void
    readonly unexport: () => void
  }

  interface GpioConstructor {
    new (
      gpio: number,
      direction: Direction,
      edge?: Edge,
      options?: GpioOptions
    ): Gpio
    accessible?: boolean
  }

  export const Gpio: GpioConstructor
}
