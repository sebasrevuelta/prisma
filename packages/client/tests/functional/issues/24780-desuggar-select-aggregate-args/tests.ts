// @ts-ignore
import type { PrismaClient } from '@prisma/client'

import testMatrix from './_matrix'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  (_suiteMeta, _clientMeta) => {
    test('select _count that is undefined', async () => {
      const result = await prisma.link.findMany({
        select: {
          user: {
            select: {
              id: true,
              _count: undefined,
            },
          },
        },
      })

      expect(result).toEqual([])
    })
  },
  {
    skipDataProxy: {
      runtimes: ['edge'],
      reason: 'Different error rendering for edge client',
    },
  },
)
