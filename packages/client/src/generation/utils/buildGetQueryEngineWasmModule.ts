import { ConnectorType } from '@prisma/generator-helper'

import { TSClientOptions } from '../TSClient/TSClient'

/**
 * Builds the necessary glue code to load the query engine wasm module.
 * @returns
 */
export function buildQueryEngineWasmModule(
  wasm: boolean,
  provider: ConnectorType,
  runtimeNameJs: TSClientOptions['runtimeNameJs'],
) {
  if (runtimeNameJs === 'library' && process.env.PRISMA_CLIENT_FORCE_WASM) {
    return `config.wasm = {
      runtime: require('./query_engine_bg.js'),
      getQueryEngineWasmModule: async () => {
        const queryEngineWasmFilePath = require('path').join(config.dirname, 'query_engine_bg.wasm')
        const queryEngineWasmFileBytes = require('fs').readFileSync(queryEngineWasmFilePath)
      
        return new WebAssembly.Module(queryEngineWasmFileBytes)
      }
    }`
  }

  // for cloudflare (workers) we need to use import in order to load wasm
  // so we use a dynamic import which is compatible with both cjs and esm
  // additionally we need to append ?module to the import path for vercel
  // this is incompatible with cloudflare, so we hide it in a template
  if (wasm === true) {
    return `config.wasm = {
      runtime: require('./query_engine_bg.js'),
      getQueryEngineWasmModule: async () => {
        if (detectRuntime() === 'edge-light') {
          return (await import(\`./query_engine_bg.wasm\${'?module'}\`)).default
        } else {
          return (await import(\`./query_engine_bg.wasm\`)).default
        }
      }
    }`
  }

  return `config.wasm = undefined`
}
