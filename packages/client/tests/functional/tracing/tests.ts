import { faker } from '@faker-js/faker'
import { context, trace } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { Resource } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { PrismaInstrumentation } from '@prisma/instrumentation'
import * as util from 'util'

import { map } from '../../../../../helpers/blaze/map'
import testMatrix from './_matrix'

type Tree = {
  span: ReadableSpan
  children?: Tree[]
}

function buildTree(tree: Tree, spans: ReadableSpan[]): Tree {
  // @ts-ignore - For JSON stringify debugging
  delete tree.span._spanProcessor

  const childrenSpans = spans.filter((span) => span.parentSpanId === tree.span.spanContext().spanId)
  if (childrenSpans.length) {
    tree.children = childrenSpans.map((span) => buildTree({ span }, spans))
  } else {
    tree.children = []
  }

  return tree
}

// @ts-ignore this is just for type checks
type PrismaClient = import('@prisma/client').PrismaClient
declare let prisma: PrismaClient
// @ts-ignore this is just for type checks
declare let newPrismaClient: NewPrismaClient<typeof PrismaClient>

let inMemorySpanExporter: InMemorySpanExporter

beforeAll(() => {
  const contextManager = new AsyncHooksContextManager().enable()
  context.setGlobalContextManager(contextManager)

  inMemorySpanExporter = new InMemorySpanExporter()

  const basicTracerProvider = new BasicTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: `test-name`,
      [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    }),
  })

  basicTracerProvider.addSpanProcessor(new SimpleSpanProcessor(inMemorySpanExporter))
  basicTracerProvider.register()

  registerInstrumentations({
    instrumentations: [new PrismaInstrumentation({ middleware: true })],
  })
})

afterAll(() => {
  context.disable()
})

testMatrix.setupTestSuite(({ provider }) => {
  beforeEach(async () => {
    await prisma.$connect()
  })

  beforeEach(() => {
    inMemorySpanExporter.reset()
  })

  async function waitForSpanTree(): Promise<Tree> {
    /*
        Spans comes thru logs and sometimes these tests
        can be flaky without giving some buffer
      */
    const logBuffer = () => util.promisify(setTimeout)(500)
    await logBuffer()

    const spans = inMemorySpanExporter.getFinishedSpans()
    const rootSpan = spans.find((span) => !span.parentSpanId) as ReadableSpan
    const tree = buildTree({ span: rootSpan }, spans)

    return tree
  }

  describe('tracing on crud methods', () => {
    let email = faker.internet.email()

    test('create', async () => {
      await prisma.user.create({
        data: {
          email: email,
        },
      })

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:operation')
      expect(tree.span.attributes['method']).toEqual('create')
      expect(tree.span.attributes['model']).toEqual('User')

      expect(tree.children).toHaveLength(1)

      const engine = (tree?.children || [])[0] as unknown as Tree
      expect(engine.span.name).toEqual('prisma:query_builder')

      const getConnection = (engine.children || [])[0]
      expect(getConnection.span.name).toEqual('prisma:connection')

      if (provider === 'mongodb') {
        expect(engine.children).toHaveLength(3)

        const dbQuery1 = (engine.children || [])[1]
        expect(dbQuery1.span.name).toEqual('prisma:db_query')
        expect(dbQuery1.span.attributes['db.statement']).toContain('db.User.insertOne(*)')

        const dbQuery2 = (engine.children || [])[2]
        expect(dbQuery2.span.name).toEqual('prisma:db_query')
        expect(dbQuery2.span.attributes['db.statement']).toContain('db.User.findOne(*)')

        return
      }

      expect(engine.children).toHaveLength(5)

      const dbQuery1 = (engine.children || [])[1]
      expect(dbQuery1.span.name).toEqual('prisma:db_query')
      expect(dbQuery1.span.attributes['db.statement']).toContain('BEGIN')

      const dbQuery2 = (engine.children || [])[2]
      expect(dbQuery2.span.name).toEqual('prisma:db_query')
      expect(dbQuery2.span.attributes['db.statement']).toContain('INSERT')

      const dbQuery3 = (engine.children || [])[3]
      expect(dbQuery3.span.name).toEqual('prisma:db_query')
      expect(dbQuery3.span.attributes['db.statement']).toContain('SELECT')

      const dbQuery4 = (engine.children || [])[4]
      expect(dbQuery4.span.name).toEqual('prisma:db_query')
      expect(dbQuery4.span.attributes['db.statement']).toContain('COMMIT')
    })

    test('read', async () => {
      await prisma.user.findMany({
        where: {
          email: email,
        },
      })

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:operation')
      expect(tree.span.attributes['method']).toEqual('findMany')
      expect(tree.span.attributes['model']).toEqual('User')

      expect(tree.children).toHaveLength(1)

      const engine = (tree?.children || [])[0] as unknown as Tree
      expect(engine.span.name).toEqual('prisma:query_builder')

      const getConnection = (engine.children || [])[0]
      expect(getConnection.span.name).toEqual('prisma:connection')

      if (provider === 'mongodb') {
        expect(engine.children).toHaveLength(2)

        const dbQuery1 = (engine.children || [])[1]
        expect(dbQuery1.span.name).toEqual('prisma:db_query')
        expect(dbQuery1.span.attributes['db.statement']).toContain('db.User.findMany(*)')

        return
      }

      expect(engine.children).toHaveLength(2)

      const select = (engine.children || [])[1]
      expect(select.span.name).toEqual('prisma:db_query')
      expect(select.span.attributes['db.statement']).toContain('SELECT')
    })

    test('update', async () => {
      const newEmail = faker.internet.email()

      await prisma.user.update({
        data: {
          email: newEmail,
        },
        where: {
          email: email,
        },
      })

      email = newEmail

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:operation')
      expect(tree.span.attributes['method']).toEqual('update')
      expect(tree.span.attributes['model']).toEqual('User')

      expect(tree.children).toHaveLength(1)

      const engine = (tree?.children || [])[0] as unknown as Tree
      expect(engine.span.name).toEqual('prisma:query_builder')

      const getConnection = (engine.children || [])[0]
      expect(getConnection.span.name).toEqual('prisma:connection')

      if (provider === 'mongodb') {
        expect(engine.children).toHaveLength(4)

        const dbQuery1 = (engine.children || [])[1]
        expect(dbQuery1.span.name).toEqual('prisma:db_query')
        expect(dbQuery1.span.attributes['db.statement']).toContain('db.User.findMany(*)')

        const dbQuery2 = (engine.children || [])[2]
        expect(dbQuery2.span.name).toEqual('prisma:db_query')
        expect(dbQuery2.span.attributes['db.statement']).toContain('db.User.updateMany(*)')

        const dbQuery3 = (engine.children || [])[3]
        expect(dbQuery3.span.name).toEqual('prisma:db_query')
        expect(dbQuery3.span.attributes['db.statement']).toContain('db.User.findOne(*)')

        return
      }

      expect(engine.children).toHaveLength(6)

      const dbQuery1 = (engine.children || [])[1]
      expect(dbQuery1.span.name).toEqual('prisma:db_query')
      expect(dbQuery1.span.attributes['db.statement']).toContain('BEGIN')

      const dbQuery2 = (engine.children || [])[2]
      expect(dbQuery2.span.name).toEqual('prisma:db_query')
      expect(dbQuery2.span.attributes['db.statement']).toContain('SELECT')

      const dbQuery3 = (engine.children || [])[3]
      expect(dbQuery3.span.name).toEqual('prisma:db_query')
      expect(dbQuery3.span.attributes['db.statement']).toContain('UPDATE')

      const dbQuery4 = (engine.children || [])[4]
      expect(dbQuery4.span.name).toEqual('prisma:db_query')
      expect(dbQuery4.span.attributes['db.statement']).toContain('SELECT')

      const dbQuery5 = (engine.children || [])[5]
      expect(dbQuery5.span.name).toEqual('prisma:db_query')
      expect(dbQuery5.span.attributes['db.statement']).toContain('COMMIT')
    })

    test('delete', async () => {
      await prisma.user.delete({
        where: {
          email: email,
        },
      })

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:operation')
      expect(tree.span.attributes['method']).toEqual('delete')
      expect(tree.span.attributes['model']).toEqual('User')

      expect(tree.children).toHaveLength(1)

      const engine = (tree?.children || [])[0] as unknown as Tree
      expect(engine.span.name).toEqual('prisma:query_builder')

      const getConnection = (engine.children || [])[0]
      expect(getConnection.span.name).toEqual('prisma:connection')

      if (provider === 'mongodb') {
        expect(engine.children).toHaveLength(4)

        const dbQuery1 = (engine.children || [])[1]
        expect(dbQuery1.span.name).toEqual('prisma:db_query')
        expect(dbQuery1.span.attributes['db.statement']).toContain('db.User.findOne(*)')

        const dbQuery2 = (engine.children || [])[2]
        expect(dbQuery2.span.name).toEqual('prisma:db_query')
        expect(dbQuery2.span.attributes['db.statement']).toContain('db.User.findMany(*)')

        const dbQuery3 = (engine.children || [])[3]
        expect(dbQuery3.span.name).toEqual('prisma:db_query')
        expect(dbQuery3.span.attributes['db.statement']).toContain('db.User.deleteMany(*)')

        return
      }

      expect(engine.children).toHaveLength(6)

      const dbQuery1 = (engine.children || [])[1]
      expect(dbQuery1.span.name).toEqual('prisma:db_query')
      expect(dbQuery1.span.attributes['db.statement']).toContain('BEGIN')

      const dbQuery2 = (engine.children || [])[2]
      expect(dbQuery2.span.name).toEqual('prisma:db_query')
      expect(dbQuery2.span.attributes['db.statement']).toContain('SELECT')

      const dbQuery3 = (engine.children || [])[3]
      expect(dbQuery3.span.name).toEqual('prisma:db_query')
      expect(dbQuery3.span.attributes['db.statement']).toContain('SELECT')

      const dbQuery4 = (engine.children || [])[4]
      expect(dbQuery4.span.name).toEqual('prisma:db_query')
      expect(dbQuery4.span.attributes['db.statement']).toContain('DELETE')

      const dbQuery5 = (engine.children || [])[5]
      expect(dbQuery5.span.name).toEqual('prisma:db_query')
      expect(dbQuery5.span.attributes['db.statement']).toContain('COMMIT')
    })
  })

  describe('tracing on transactions', () => {
    test('$transaction', async () => {
      const email = faker.internet.email()

      await prisma.$transaction([
        prisma.user.create({
          data: {
            email,
          },
        }),
        prisma.user.findMany({
          where: {
            email,
          },
        }),
      ])

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:transaction')
      expect(tree.span.attributes['method']).toEqual('$transaction')
      expect(tree.children).toHaveLength(3)

      const create = (tree?.children || [])[0] as unknown as Tree
      expect(create.span.name).toEqual('prisma:client:operation')
      expect(create.span.attributes.model).toEqual('User')
      expect(create.span.attributes.method).toEqual('create')

      const findMany = (tree?.children || [])[1] as unknown as Tree
      expect(findMany.span.name).toEqual('prisma:client:operation')
      expect(findMany.span.attributes.model).toEqual('User')
      expect(findMany.span.attributes.method).toEqual('findMany')

      const queryBuilder = (tree?.children || [])[2] as unknown as Tree
      expect(queryBuilder.span.name).toEqual('prisma:query_builder')

      if (provider === 'mongodb') {
        expect(queryBuilder.children).toHaveLength(4)

        return
      }

      expect(queryBuilder.children).toHaveLength(6)
    })

    test('interactive-transactions', async () => {
      const email = faker.internet.email()

      // @ts-ignore
      await prisma.$transaction(async (client) => {
        await client.user.create({
          data: {
            email,
          },
        })
        await client.user.findMany({
          where: {
            email,
          },
        })
      })

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:transaction')
      expect(tree.span.attributes['method']).toEqual('$transaction')
      expect(tree.children).toHaveLength(3)

      const create = (tree?.children || [])[0] as unknown as Tree
      expect(create.span.name).toEqual('prisma:client:operation')
      expect(create.span.attributes.model).toEqual('User')
      expect(create.span.attributes.method).toEqual('create')

      const findMany = (tree?.children || [])[1] as unknown as Tree
      expect(findMany.span.name).toEqual('prisma:client:operation')
      expect(findMany.span.attributes.model).toEqual('User')
      expect(findMany.span.attributes.method).toEqual('findMany')

      const queryBuilder = (tree?.children || [])[2] as unknown as Tree
      expect(queryBuilder.span.name).toEqual('prisma:itx_runner')

      if (provider === 'mongodb') {
        expect(queryBuilder.children).toHaveLength(3)

        return
      }

      expect(queryBuilder.children).toHaveLength(5)
    })
  })

  describe('tracing on $raw methods', () => {
    test('$queryRaw', async () => {
      if (provider === 'mongodb') {
        return
      }

      // @ts-test-if: provider !== 'mongodb'
      await prisma.$queryRaw`SELECT 1 + 1;`

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:operation')
      expect(tree.span.attributes['method']).toEqual('queryRaw')

      expect(tree.children).toHaveLength(1)

      const engine = (tree?.children || [])[0] as unknown as Tree
      expect(engine.span.name).toEqual('prisma:query_builder')

      expect(engine.children).toHaveLength(2)

      const getConnection = (engine.children || [])[0]
      expect(getConnection.span.name).toEqual('prisma:connection')

      const dbQuery1 = (engine.children || [])[1]
      expect(dbQuery1.span.name).toEqual('prisma:db_query')
      expect(dbQuery1.span.attributes['db.statement']).toEqual('SELECT 1 + 1;')
    })

    test('$executeRaw', async () => {
      // Raw query failed. Code: `N/A`. Message: `Execute returned results, which is not allowed in SQLite.`
      if (provider === 'sqlite' || provider === 'mongodb') {
        return
      }

      // @ts-test-if: provider !== 'mongodb'
      await prisma.$executeRaw`SELECT 1 + 1;`

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:operation')
      expect(tree.span.attributes['method']).toEqual('executeRaw')

      expect(tree.children).toHaveLength(1)

      const engine = (tree?.children || [])[0] as unknown as Tree
      expect(engine.span.name).toEqual('prisma:query_builder')

      expect(engine.children).toHaveLength(2)

      const getConnection = (engine.children || [])[0]
      expect(getConnection.span.name).toEqual('prisma:connection')

      const dbQuery1 = (engine.children || [])[1]
      expect(dbQuery1.span.name).toEqual('prisma:db_query')
      expect(dbQuery1.span.attributes['db.statement']).toEqual('SELECT 1 + 1;')
    })
  })

  test('tracing with custom span', async () => {
    const tracer = trace.getTracer('MyApp')
    const email = faker.internet.email()

    await tracer.startActiveSpan('create-user', async (span) => {
      try {
        return await prisma.user.create({
          data: {
            email: email,
          },
        })
      } finally {
        span.end()
      }
    })

    const tree = await waitForSpanTree()

    expect(tree.span.name).toEqual('create-user')

    const prismaSpan = (tree.children || [])[0]

    expect(prismaSpan.span.name).toEqual('prisma:client:operation')
    expect(prismaSpan.span.attributes['method']).toEqual('create')
    expect(prismaSpan.span.attributes['model']).toEqual('User')

    expect(prismaSpan.children).toHaveLength(1)

    const engine = (prismaSpan?.children || [])[0] as unknown as Tree
    expect(engine.span.name).toEqual('prisma:query_builder')

    const getConnection = (engine.children || [])[0]
    expect(getConnection.span.name).toEqual('prisma:connection')

    if (provider === 'mongodb') {
      expect(engine.children).toHaveLength(3)

      const dbQuery1 = (engine.children || [])[1]
      expect(dbQuery1.span.name).toEqual('prisma:db_query')
      expect(dbQuery1.span.attributes['db.statement']).toContain('db.User.insertOne(*)')

      const dbQuery2 = (engine.children || [])[2]
      expect(dbQuery2.span.name).toEqual('prisma:db_query')
      expect(dbQuery2.span.attributes['db.statement']).toContain('db.User.findOne(*)')

      return
    }

    expect(engine.children).toHaveLength(5)

    const dbQuery1 = (engine.children || [])[1]
    expect(dbQuery1.span.name).toEqual('prisma:db_query')
    expect(dbQuery1.span.attributes['db.statement']).toContain('BEGIN')

    const dbQuery2 = (engine.children || [])[2]
    expect(dbQuery2.span.name).toEqual('prisma:db_query')
    expect(dbQuery2.span.attributes['db.statement']).toContain('INSERT')

    const dbQuery3 = (engine.children || [])[3]
    expect(dbQuery3.span.name).toEqual('prisma:db_query')
    expect(dbQuery3.span.attributes['db.statement']).toContain('SELECT')

    const dbQuery4 = (engine.children || [])[4]
    expect(dbQuery4.span.name).toEqual('prisma:db_query')
    expect(dbQuery4.span.attributes['db.statement']).toContain('COMMIT')
  })

  describe('tracing with middleware', () => {
    // @ts-ignore
    let _prisma: PrismaClient

    beforeAll(async () => {
      _prisma = newPrismaClient()

      await _prisma.$connect()
    })

    test('tracing with middleware', async () => {
      const email = faker.internet.email()

      _prisma.$use(async (params, next) => {
        // Manipulate params here
        const result = await next(params)
        // See results here
        return result
      })
      _prisma.$use(async (params, next) => {
        // Manipulate params here
        const result = await next(params)
        // See results here
        return result
      })

      await _prisma.user.create({
        data: {
          email: email,
        },
      })

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:operation')
      expect(tree.span.attributes['method']).toEqual('create')
      expect(tree.span.attributes['model']).toEqual('User')

      expect(tree.children).toHaveLength(1)

      const middleware1 = (tree.children || [])[0] as unknown as Tree
      expect(middleware1.children).toHaveLength(1)

      const middleware2 = (middleware1.children || [])[0] as unknown as Tree
      expect(middleware2.children).toHaveLength(1)

      const engine = (middleware2.children || []).find(({ span }) => span.name === 'prisma:query_builder') as Tree

      const getConnection = (engine.children || [])[0]
      expect(getConnection.span.name).toEqual('prisma:connection')

      if (provider === 'mongodb') {
        expect(engine.children).toHaveLength(3)

        const dbQuery1 = (engine.children || [])[1]
        expect(dbQuery1.span.name).toEqual('prisma:db_query')
        expect(dbQuery1.span.attributes['db.statement']).toContain('db.User.insertOne(*)')

        const dbQuery2 = (engine.children || [])[2]
        expect(dbQuery2.span.name).toEqual('prisma:db_query')
        expect(dbQuery2.span.attributes['db.statement']).toContain('db.User.findOne(*)')

        return
      }

      expect(engine.children).toHaveLength(5)

      const dbQuery1 = (engine.children || [])[1]
      expect(dbQuery1.span.name).toEqual('prisma:db_query')
      expect(dbQuery1.span.attributes['db.statement']).toContain('BEGIN')

      const dbQuery2 = (engine.children || [])[2]
      expect(dbQuery2.span.name).toEqual('prisma:db_query')
      expect(dbQuery2.span.attributes['db.statement']).toContain('INSERT')

      const dbQuery3 = (engine.children || [])[3]
      expect(dbQuery3.span.name).toEqual('prisma:db_query')
      expect(dbQuery3.span.attributes['db.statement']).toContain('SELECT')

      const dbQuery4 = (engine.children || [])[4]
      expect(dbQuery4.span.name).toEqual('prisma:db_query')
      expect(dbQuery4.span.attributes['db.statement']).toContain('COMMIT')
    })
  })

  describe('Tracing connect', () => {
    // @ts-ignore
    let _prisma: PrismaClient

    beforeAll(() => {
      _prisma = newPrismaClient()
    })

    afterAll(async () => {
      await _prisma.$disconnect()
    })

    test('should trace the implict $connect call', async () => {
      const email = faker.internet.email()

      await _prisma.user.findMany({
        where: {
          email: email,
        },
      })

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:operation')
      expect(tree.span.attributes['method']).toEqual('findMany')
      expect(tree.span.attributes['model']).toEqual('User')

      expect(tree.children).toHaveLength(2)

      const connect = (tree?.children || [])[0] as unknown as Tree
      expect(connect.span.name).toEqual('prisma:client:connect')

      const engine = (tree?.children || [])[1] as unknown as Tree
      expect(engine.span.name).toEqual('prisma:query_builder')

      const getConnection = (engine.children || [])[0]
      expect(getConnection.span.name).toEqual('prisma:connection')

      if (provider === 'mongodb') {
        expect(engine.children).toHaveLength(2)

        const dbQuery1 = (engine.children || [])[1]
        expect(dbQuery1.span.name).toEqual('prisma:db_query')
        expect(dbQuery1.span.attributes['db.statement']).toContain('db.User.findMany(*)')

        return
      }

      expect(engine.children).toHaveLength(2)

      const select = (engine.children || [])[1]
      expect(select.span.name).toEqual('prisma:db_query')
      expect(select.span.attributes['db.statement']).toContain('SELECT')
    })
  })

  describe('Tracing disconnect', () => {
    // @ts-ignore
    let _prisma: PrismaClient

    beforeAll(async () => {
      _prisma = newPrismaClient()
      await _prisma.$connect()
    })

    test('should trace $disconnect', async () => {
      await _prisma.$disconnect()

      const tree = await waitForSpanTree()

      expect(tree.span.name).toEqual('prisma:client:disconnect')
    })
  })
})
