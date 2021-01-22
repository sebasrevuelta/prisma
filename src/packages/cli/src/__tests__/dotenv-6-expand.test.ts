import { consoleContext, Context } from './__helpers__/context'

const ctx = Context.new().add(consoleContext()).assemble()

it('should read expanded env vars', async () => {
  console.debug(
    'process.env.DEBUG',
    process.env.DEBUG,
    typeof process.env.DEBUG,
  )
  ctx.fixture('dotenv-6-expand')
  process.argv.push('--version')
  process.argv.push('--schema=./expand/schema.prisma')
  await import('../bin')
  console.debug(
    'process.env.DEBUG',
    process.env.DEBUG,
    typeof process.env.DEBUG,
  )
  expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchSnapshot()
  expect(process.env.DOTENV_PRISMA_EXPAND_DATABASE_URL_WITH_SCHEMA).toEqual(
    'postgres://user:password@server.host:5432/database?ssl=1&schema=schema1234',
  )
})
