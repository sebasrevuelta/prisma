// importing it this way, rather than `export { debug as Debug } ensures it works for ESM
// as well as CJS
import * as debug from 'debug'

export const Debug = debug.debug
