// @ts-ignore
import type { PrismaClient } from '@prisma/client'

import testMatrix from './_matrix'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(() => {
  let user: any

  beforeAll(async () => {
    await prisma.link.deleteMany()
    await prisma.user.deleteMany()

    user = await prisma.user.create({
      data: {
        email: 'user@prisma.io',
        links: {
          create: [{ url: 'https://www.prisma.io/' }],
        },
      },
      include: {
        links: {
          select: {
            id: true,
            url: true,
          },
        },
      },
    })
  })

  test('should return _count if it is explicitly undefined', async () => {
    const result = await prisma.link.findMany({
      select: {
        user: {
          select: {
            _count: undefined,
          },
        },
      },
    })

    expect(result).toEqual([
      {
        user: {
          _count: {
            links: user.links.length,
          },
        },
      },
    ])
  })

  test('should return _count if it is explicitly undefined and other fields are selected', async () => {
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

    expect(result).toEqual([
      {
        user: {
          id: user.id,
          _count: {
            links: user.links.length,
          },
        },
      },
    ])
  })

  test('should return _count if it is explicitly undefined in include', async () => {
    const result = await prisma.link.findMany({
      include: {
        user: {
          include: {
            _count: undefined,
          },
        },
      },
    })

    expect(result).toEqual([
      {
        id: user.links[0].id,
        url: user.links[0].url,
        user: {
          _count: {
            links: user.links.length,
          },
          email: user.email,
          id: user.id,
        },
        userId: user.id,
      },
    ])
  })

  test('should return _count if it is explicitly undefined in include and other fields are included', async () => {
    const result = await prisma.link.findMany({
      include: {
        user: {
          include: {
            _count: undefined,
            links: true,
          },
        },
      },
    })

    expect(result).toEqual([
      {
        id: user.links[0].id,
        url: user.links[0].url,
        user: {
          _count: {
            links: user.links.length,
          },
          email: user.email,
          id: user.id,
          links: [
            {
              id: user.links[0].id,
              url: user.links[0].url,
              userId: user.id,
            },
          ],
        },
        userId: user.id,
      },
    ])
  })
})
