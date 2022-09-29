import type * as esbuild from 'esbuild'

import { run } from '../run'

/**
 * Triggers the TypeScript compiler.
 */
export const tscPlugin: esbuild.Plugin = {
  name: 'tscPlugin',
  setup(build) {
    const options = build.initialOptions

    if (process.env.DEV === 'true') return

    build.onStart(async () => {
      // --paths null basically prevents typescript from using paths from the
      // tsconfig.json that is passed from the esbuild config. We need to do
      // this because TS would include types from the paths into this build.
      // But our paths, in our specific case only represent separate packages.
      await run(`tsc --project ${options.tsconfig} --paths null`)
    })
  },
}
