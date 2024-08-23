// @ts-ignore
import type { PrismaClient } from '@prisma/client'

import testMatrix from './_matrix'

declare let prisma: PrismaClient

testMatrix.setupTestSuite((_suiteMeta, _clientMeta) => {
  test('select _count that is undefined', async () => {
    const result = prisma.link.findMany({
      select: {
        user: {
          select: {
            _count: undefined,
          },
        },
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
      "
      Invalid \`prisma.link.findMany()\` invocation in
      /client/tests/functional/issues/24780-undefined-select-aggregate-args/tests.ts:0:0

         XX 
         XX testMatrix.setupTestSuite((_suiteMeta, _clientMeta) => {
         XX   test('select _count that is undefined', async () => {
      → XX     const result = prisma.link.findMany({
                 select: {
                   user: {
                     select: {
               ?       id?: true,
               ?       links?: true,
               ?       _count?: true
                     }
                   }
                 }
               })

      The \`select\` statement for type User needs at least one truthy value."
    `)
  })

  test('select id field with _count that is undefined', async () => {
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
})
