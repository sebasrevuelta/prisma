import { faker } from '@faker-js/faker'
import { assertNever } from '@prisma/internals'
import * as miniProxy from '@prisma/mini-proxy'
import execa from 'execa'
import fs from 'fs-extra'
import path from 'path'
import { match } from 'ts-pattern'
import { Script } from 'vm'

import { DbDrop } from '../../../../migrate/src/commands/DbDrop'
import { DbExecute } from '../../../../migrate/src/commands/DbExecute'
import { DbPush } from '../../../../migrate/src/commands/DbPush'
import type { Client } from '../../../src/runtime/getPrismaClient'
import type { NamedTestSuiteConfig } from './getTestSuiteInfo'
import { getTestSuiteFolderPath, getTestSuiteSchemaPath } from './getTestSuiteInfo'
import { AdapterProviders, Providers } from './providers'
import type { TestSuiteMeta } from './setupTestSuiteMatrix'
import { AlterStatementCallback, ClientMeta } from './types'

const DB_NAME_VAR = 'PRISMA_DB_NAME'

/**
 * Copies the necessary files for the generated test suite folder.
 * @param suiteMeta
 * @param suiteConfig
 */
export async function setupTestSuiteFiles(suiteMeta: TestSuiteMeta, suiteConfig: NamedTestSuiteConfig) {
  const suiteFolder = getTestSuiteFolderPath(suiteMeta, suiteConfig)

  // we copy the minimum amount of files needed for the test suite
  await fs.copy(path.join(suiteMeta.testRoot, 'prisma'), path.join(suiteFolder, 'prisma'))
  await fs.mkdir(path.join(suiteFolder, suiteMeta.rootRelativeTestDir), { recursive: true })
  await copyPreprocessed(
    suiteMeta.testPath,
    path.join(suiteFolder, suiteMeta.rootRelativeTestPath),
    suiteConfig.matrixOptions,
  )
}

/**
 * Copies test file into generated subdirectory and pre-processes it
 * in the following way:
 *
 * 1. Adjusts relative imports so they'll work from generated subfolder
 * 2. Evaluates @ts-test-if magic comments and replaces them with @ts-expect-error
 * if necessary
 *
 * @param from
 * @param to
 * @param suiteConfig
 */
async function copyPreprocessed(from: string, to: string, suiteConfig: Record<string, string>): Promise<void> {
  // we adjust the relative paths to work from the generated folder
  const contents = await fs.readFile(from, 'utf8')
  const newContents = contents
    .replace(/'\.\.\//g, "'../../../")
    .replace(/'\.\//g, "'../../")
    .replace(/'\.\.\/\.\.\/node_modules/g, "'./node_modules")
    .replace(/\/\/\s*@ts-ignore.*/g, '')
    .replace(/\/\/\s*@ts-test-if:(.+)/g, (match, condition) => {
      if (!evaluateMagicComment(condition, suiteConfig)) {
        return '// @ts-expect-error'
      }
      return match
    })

  await fs.writeFile(to, newContents, 'utf8')
}

/**
 * Evaluates the condition from @ts-test-if magic comment as
 * a JS expression.
 * All properties from suite config are available as variables
 * within the expression.
 *
 * @param conditionFromComment
 * @param suiteConfig
 * @returns
 */
function evaluateMagicComment(conditionFromComment: string, suiteConfig: Record<string, string>): boolean {
  const script = new Script(`
  ${conditionFromComment}
  `)

  const value = script.runInNewContext({
    ...suiteConfig,
    Providers,
  })
  return Boolean(value)
}

/**
 * Write the generated test suite schema to the test suite folder.
 * @param suiteMeta
 * @param suiteConfig
 * @param schema
 */
export async function setupTestSuiteSchema(
  suiteMeta: TestSuiteMeta,
  suiteConfig: NamedTestSuiteConfig,
  schema: string,
) {
  const schemaPath = getTestSuiteSchemaPath(suiteMeta, suiteConfig)

  await fs.writeFile(schemaPath, schema)
}

/**
 * Create a database for the generated schema of the test suite.
 * @param suiteMeta
 * @param suiteConfig
 */
export async function setupTestSuiteDatabase(
  suiteMeta: TestSuiteMeta,
  suiteConfig: NamedTestSuiteConfig,
  errors: Error[] = [],
  client?: Client,
  alterStatementCallback?: AlterStatementCallback,
) {
  const schemaPath = getTestSuiteSchemaPath(suiteMeta, suiteConfig)

  try {
    const consoleInfoMock = jest.spyOn(console, 'info').mockImplementation()
    const dbPushParams = ['--schema', schemaPath, '--skip-generate']

    // we reuse and clean the db when it is explicitly required
    if (process.env.TEST_REUSE_DATABASE === 'true') {
      dbPushParams.push('--force-reset')
    }

    // The Schema Engine does not know how to use a Driver Adapter at the moment
    // So we cannot use `db push` for D1
    if (suiteConfig.matrixOptions.driverAdapter === AdapterProviders.JS_D1) {
      if (!client) {
        throw new Error('Client must be provided to `setupTestSuiteDatabase` when using D1 adapter')
      }

      // Delete existing tables
      const existingTables = await client.$queryRaw`PRAGMA main.table_list;`
      for (const table of existingTables as Record<string, unknown>[]) {
        if (table.name === '_cf_KV' || table.name === 'sqlite_schema') {
          continue
        }
        console.log(await client.$executeRawUnsafe(`DROP TABLE ${table.name};`))
      }

      // Use `migrate diff` to get the DDL statements
      const diffResult = await execa(
        '../cli/src/bin.ts',
        ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'],
        {
          env: {
            DEBUG: process.env.DEBUG,
          },
        },
      )
      const sqlStatements = diffResult.stdout

      // Execute the DDL statements
      for (const sqlStatement of sqlStatements.split(';')) {
        if (sqlStatement.includes('CREATE ')) {
          await client.$executeRawUnsafe(sqlStatement)
        } else if (sqlStatement === '\n') {
          // Ignore
        } else {
          console.debug(`Skipping ${sqlStatement} as it is not a CREATE statement`)
        }
      }
    } else {
      await DbPush.new().parse(dbPushParams)
    }

    if (
      suiteConfig.matrixOptions.driverAdapter === AdapterProviders.VITESS_8 ||
      suiteConfig.matrixOptions.driverAdapter === AdapterProviders.JS_PLANETSCALE
    ) {
      // wait for vitess to catch up, corresponds to TABLET_REFRESH_INTERVAL in docker-compose.yml
      await new Promise((r) => setTimeout(r, 1_000))
    }

    // TODO later for D1 (I think it's only used for one test)
    if (alterStatementCallback) {
      const { provider } = suiteConfig.matrixOptions
      const prismaDir = path.dirname(schemaPath)
      const timestamp = new Date().getTime()

      if (provider === Providers.MONGODB) {
        throw new Error('DbExecute not supported with mongodb')
      }

      await fs.promises.mkdir(`${prismaDir}/migrations/${timestamp}`, { recursive: true })
      await fs.promises.writeFile(`${prismaDir}/migrations/migration_lock.toml`, `provider = "${provider}"`)
      await fs.promises.writeFile(
        `${prismaDir}/migrations/${timestamp}/migration.sql`,
        alterStatementCallback(provider),
      )

      await DbExecute.new().parse([
        '--file',
        `${prismaDir}/migrations/${timestamp}/migration.sql`,
        '--schema',
        `${schemaPath}`,
      ])
    }

    consoleInfoMock.mockRestore()
  } catch (e) {
    errors.push(e as Error)

    if (errors.length > 2) {
      throw new Error(errors.map((e) => `${e.message}\n${e.stack}`).join(`\n`))
    } else {
      await setupTestSuiteDatabase(suiteMeta, suiteConfig, errors, client) // retry logic
    }
  }
}

/**
 * Drop the database for the generated schema of the test suite.
 * @param suiteMeta
 * @param suiteConfig
 */
export async function dropTestSuiteDatabase(
  suiteMeta: TestSuiteMeta,
  suiteConfig: NamedTestSuiteConfig,
  errors: Error[] = [],
) {
  const schemaPath = getTestSuiteSchemaPath(suiteMeta, suiteConfig)

  try {
    const consoleInfoMock = jest.spyOn(console, 'info').mockImplementation()
    await DbDrop.new().parse(['--schema', schemaPath, '--force', '--preview-feature'])
    consoleInfoMock.mockRestore()
  } catch (e) {
    errors.push(e as Error)

    if (errors.length > 2) {
      throw new Error(errors.map((e) => `${e.message}\n${e.stack}`).join(`\n`))
    } else {
      await dropTestSuiteDatabase(suiteMeta, suiteConfig, errors) // retry logic
    }
  }
}

export type DatasourceInfo = {
  directEnvVarName: string
  envVarName: string
  databaseUrl: string
  dataProxyUrl?: string
}

/**
 * Generate a random string to be used as a test suite db name, and derive the
 * corresponding database URL and, if required, Mini-Proxy connection string to
 * that database.
 *
 * @param suiteConfig
 * @param clientMeta
 * @returns
 */
export function setupTestSuiteDbURI(
  suiteConfig: NamedTestSuiteConfig['matrixOptions'],
  clientMeta: ClientMeta,
): DatasourceInfo {
  const { provider, driverAdapter } = suiteConfig

  const envVarName = `DATABASE_URI_${provider}`
  const directEnvVarName = `DIRECT_${envVarName}`

  let databaseUrl = match(driverAdapter)
    .with(undefined, () => getDbUrl(provider))
    .otherwise(() => getDbUrlFromFlavor(driverAdapter, provider))

  if (process.env.TEST_REUSE_DATABASE === 'true') {
    // we reuse and clean the same db when running in single-threaded mode
    databaseUrl = databaseUrl.replace(DB_NAME_VAR, 'test-0000-00000000')
  } else {
    const dbId = `${faker.string.alphanumeric(5)}-${process.pid}-${Date.now()}`
    databaseUrl = databaseUrl.replace(DB_NAME_VAR, dbId)
  }

  let dataProxyUrl: string | undefined
  if (clientMeta.dataProxy) {
    dataProxyUrl = miniProxy.generateConnectionString({
      databaseUrl,
      envVar: envVarName,
      port: miniProxy.defaultServerConfig.port,
    })
  }

  return {
    directEnvVarName,
    envVarName,
    databaseUrl,
    dataProxyUrl,
  }
}

/**
 * Returns configured database URL for specified provider
 * @param provider
 * @returns
 */
function getDbUrl(provider: Providers): string {
  switch (provider) {
    case Providers.SQLITE:
      return `file:${DB_NAME_VAR}.db`
    case Providers.MONGODB:
      return requireEnvVariable('TEST_FUNCTIONAL_MONGO_URI')
    case Providers.POSTGRESQL:
      return requireEnvVariable('TEST_FUNCTIONAL_POSTGRES_URI')
    case Providers.MYSQL:
      return requireEnvVariable('TEST_FUNCTIONAL_MYSQL_URI')
    case Providers.COCKROACHDB:
      return requireEnvVariable('TEST_FUNCTIONAL_COCKROACH_URI')
    case Providers.SQLSERVER:
      return requireEnvVariable('TEST_FUNCTIONAL_MSSQL_URI')
    default:
      assertNever(provider, `No URL for provider ${provider} configured`)
  }
}

/**
 * Returns configured database URL for specified provider, Driver Adapter, or provider variant (e.g., Vitess 8 is a known variant of the "mysql" provider),
 * falling back to `getDbUrl(provider)` if no specific URL is configured.
 * @param driverAdapter provider variant, e.g. `vitess` for `mysql`
 * @param provider provider supported by Prisma, e.g. `mysql`
 */
function getDbUrlFromFlavor(driverAdapterOrFlavor: `${AdapterProviders}` | undefined, provider: Providers): string {
  return (
    match(driverAdapterOrFlavor)
      .with(AdapterProviders.VITESS_8, () => requireEnvVariable('TEST_FUNCTIONAL_VITESS_8_URI'))
      // Note: we're using Postgres 10 for Postgres (Rust driver, `pg` driver adapter),
      // and Postgres 16 for Neon due to https://github.com/prisma/team-orm/issues/511.
      .with(AdapterProviders.JS_PG, () => requireEnvVariable('TEST_FUNCTIONAL_POSTGRES_URI'))
      .with(AdapterProviders.JS_NEON, () => requireEnvVariable('TEST_FUNCTIONAL_POSTGRES_16_URI'))
      .with(AdapterProviders.JS_PLANETSCALE, () => requireEnvVariable('TEST_FUNCTIONAL_VITESS_8_URI'))
      .with(AdapterProviders.JS_LIBSQL, () => requireEnvVariable('TEST_FUNCTIONAL_LIBSQL_FILE_URI'))
      .otherwise(() => getDbUrl(provider))
  )
}

/**
 * Gets the value of environment variable or throws error if it is not set
 * @param varName
 * @returns
 */
function requireEnvVariable(varName: string): string {
  const value = process.env[varName]
  if (!value) {
    throw new Error(
      `Required env variable ${varName} is not set. See https://github.com/prisma/prisma/blob/main/TESTING.md for instructions`,
    )
  }
  if (!value.includes(DB_NAME_VAR)) {
    throw new Error(
      `Env variable ${varName} must include ${DB_NAME_VAR} placeholder. See https://github.com/prisma/prisma/blob/main/TESTING.md for instructions`,
    )
  }
  return value
}
