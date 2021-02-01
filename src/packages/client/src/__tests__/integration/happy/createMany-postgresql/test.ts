import path from 'path'
import { getTestClient } from '../../../../utils/getTestClient'
import { tearDownPostgres } from '../../../../utils/setupPostgres'
import { migrateDb } from '../../__helpers__/migrateDb'
describe('createMany(postgres)', () => {
  beforeAll(async () => {
    process.env.TEST_POSTGRES_URI += '-createMany'
    await tearDownPostgres(process.env.TEST_POSTGRES_URI!)
    await migrateDb({
      connectionString: process.env.TEST_POSTGRES_URI!,
      schemaPath: path.join(__dirname, 'schema.prisma'),
    })
  })

  test('basic', async () => {
    // start with a fresh db
    const PrismaClient = await getTestClient()

    const prisma = new PrismaClient()

    await prisma.post.deleteMany()
    await prisma.user.deleteMany()

    const created = await prisma.user.createMany({
      data: [
        {
          email: 'a@b.de',
        },
        {
          email: 'b@b.de',
        },
        {
          email: 'c@b.de',
        },
        {
          email: 'd@b.de',
        },
      ],
    })
    expect(created.count).toEqual(4)
    prisma.$disconnect()
  })
  test('user.create(posts: createMany: data as object)', async () => {
    // start with a fresh db
    const PrismaClient = await getTestClient()
    const prisma = new PrismaClient()
    await prisma.post.deleteMany()
    await prisma.user.deleteMany()

    const res = await prisma.user.create({
      include: {
        posts: true,
      },
      data: {
        name: 'test',
        email: 'test@2.com',
        posts: {
          createMany: {
            data: {
              title: 'event',
            },
          },
        },
      },
    })
    expect(res.email).toEqual('test@2.com')
    expect(res.posts.length).toEqual(1)

    prisma.$disconnect()
  })
  test('user.create(posts: createMany: data as array)', async () => {
    // start with a fresh db
    const PrismaClient = await getTestClient()
    const prisma = new PrismaClient()
    await prisma.post.deleteMany()
    await prisma.user.deleteMany()

    const res = await prisma.user.create({
      include: {
        posts: true,
      },
      data: {
        name: 'test',
        email: 'test@2.com',
        posts: {
          createMany: {
            data: [
              { title: '1' },
              { title: '2' },
              { title: '3' },
              { title: '4' },
            ],
          },
        },
      },
    })
    expect(res.email).toEqual('test@2.com')
    expect(res.posts.length).toEqual(4)

    prisma.$disconnect()
  })
})