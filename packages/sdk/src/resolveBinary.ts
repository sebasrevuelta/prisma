import Debug from '@prisma/debug'
import { plusX } from '@prisma/engine-core'
import { getEnginesPath } from '@prisma/engines'
import { BinaryType } from '@prisma/fetch-engine'
import { getNodeAPIName, getPlatform } from '@prisma/get-platform'
import fs from 'fs'
import makeDir from 'make-dir'
import path from 'path'
import tempDir from 'temp-dir'
import tempy from 'tempy'

const debug = Debug('prisma:resolveBinary')

async function getBinaryName(name: BinaryType): Promise<string> {
  const platform = await getPlatform()
  const extension = platform === 'windows' ? '.exe' : ''

  if (name === BinaryType.libqueryEngine) {
    return getNodeAPIName(platform, 'fs')
  }
  return `${name}-${platform}${extension}`
}

export const engineEnvVarMap = {
  [BinaryType.queryEngine]: 'PRISMA_QUERY_ENGINE_BINARY',
  [BinaryType.libqueryEngine]: 'PRISMA_QUERY_ENGINE_LIBRARY',
  [BinaryType.migrationEngine]: 'PRISMA_MIGRATION_ENGINE_BINARY',
  [BinaryType.introspectionEngine]: 'PRISMA_INTROSPECTION_ENGINE_BINARY',
  [BinaryType.prismaFmt]: 'PRISMA_FMT_BINARY',
}

export { BinaryType }

export async function resolveBinary(name: BinaryType, proposedPath?: string): Promise<string> {
  if (proposedPath && !proposedPath.startsWith('/snapshot/') && fs.existsSync(proposedPath)) {
    return proposedPath
  }

  const envVar = engineEnvVarMap[name]

  if (process.env[envVar]) {
    if (!fs.existsSync(process.env[envVar]!)) {
      throw new Error(`Env var ${envVar} is provided, but provided path ${process.env[envVar]} can't be resolved.`)
    }
    return process.env[envVar]!
  }

  const dir = eval('__dirname')

  const binaryName = await getBinaryName(name)

  let prismaPath = path.join(getEnginesPath(), binaryName)
  if (fs.existsSync(prismaPath)) {
    return maybeCopyToTmp(prismaPath)
  }
  // for pkg
  prismaPath = path.join(__dirname, '..', binaryName)
  if (fs.existsSync(prismaPath)) {
    return maybeCopyToTmp(prismaPath)
  }

  prismaPath = path.join(__dirname, '../..', binaryName)
  if (fs.existsSync(prismaPath)) {
    return maybeCopyToTmp(prismaPath)
  }

  // needed to come from @prisma/client/generator-build to @prisma/client/runtime
  prismaPath = path.join(__dirname, '../runtime', binaryName)
  if (fs.existsSync(prismaPath)) {
    return maybeCopyToTmp(prismaPath)
  }

  throw new Error(
    `Could not find ${name} binary. Searched in ${path.join(dir, '..', binaryName)} and ${path.join(
      dir,
      '../..',
      binaryName,
    )}`,
  )
}

export async function maybeCopyToTmp(file: string): Promise<string> {
  // in this case, we are in a "pkg" context with a virtual fs
  // to make this work, we need to copy the binary to /tmp and execute it from there

  const dir: string = eval('__dirname')
  if (dir.startsWith('/snapshot/')) {
    const targetDir = path.join(tempDir, 'prisma-binaries')
    await makeDir(targetDir)
    const target = path.join(targetDir, path.basename(file))
    const data = await fs.promises.readFile(file)
    await fs.promises.writeFile(target, data)
    // We have to read and write until https://github.com/zeit/pkg/issues/639
    // is resolved
    // await copyFile(file, target)
    plusX(target)
    return target
  }

  if (await shouldCopyBinaryToTmp(file)) {
    const tempDir = tempy.directory({ prefix: 'prisma' })
    const newBinaryPath = path.join(tempDir, path.basename(file))
    debug('Copying %s to %s', file, newBinaryPath)
    await fs.promises.copyFile(file, newBinaryPath)
    return newBinaryPath
  }

  return file
}

async function shouldCopyBinaryToTmp(file: string): Promise<boolean> {
  return shouldCopyQueryEngineLibraryToTmp() && (await isQueryEngineLibrary(file))
}

async function isQueryEngineLibrary(file: string): Promise<boolean> {
  const libQueryEngineName = await getBinaryName(BinaryType.libqueryEngine)
  return path.basename(file) === libQueryEngineName
}

function shouldCopyQueryEngineLibraryToTmp(): boolean {
  const envConfig = process.env.PRISMA_COPY_LIBRARY_ENGINE_TO_TMP
  debug('PRISMA_COPY_LIBRARY_ENGINE_TO_TMP', envConfig)

  if (envConfig !== undefined) {
    return parseBoolean(envConfig)
  }

  if (process.platform === 'win32') {
    debug('Windows detected, copying the query engine library to tmp by default')
    return true
  }

  return false
}

function parseBoolean(value: string): boolean {
  return !['', 'false', '0'].includes(value)
}
