import path from 'path'
import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    await $`pnpm prisma db push`
  },
  test: async () => {
    // ensure that we already have an engine, as expected
    if ((await hasEngineFile()) === false) {
      throw new Error('libquery_engine-debian.so should be found')
    }

    // generate with no engine and ensure that it is gone
    await $`pnpm prisma generate --no-engine`

    if ((await hasEngineFile()) === true) {
      throw new Error('libquery_engine-debian.so should not be found')
    }

    // generate again without no engine and make a query
    await $`pnpm prisma generate`

    await $`pnpm jest`
  },
  finish: async () => {
    await $`echo "done"`
  },
})

async function hasEngineFile() {
  const prismaPath = path.dirname(
    require.resolve('.prisma/client', {
      paths: [path.dirname(require.resolve('@prisma/client'))],
    }),
  )

  let hasEngineFile = false
  for await (const line of $`ls -l ${prismaPath}`.stdout) {
    if (line.includes('libquery_engine-debian')) {
      hasEngineFile = true
    }
  }

  return hasEngineFile
}
