declare module '@/i2c-stub.js' {
  import type * as I2CBus from 'i2c-bus';
  const i2c: typeof I2CBus;
  export default i2c;
}