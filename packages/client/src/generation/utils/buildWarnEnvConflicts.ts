/**
 * Builds the necessary bits so that our users can get a helpful warning during
 * "generate" in case of conflicts between their environment & their env files.
 * @param edge
 * @param runtimeBase
 * @param runtimeName
 * @returns
 */
export function buildWarnEnvConflicts(edge: boolean, runtimeBase: string, runtimeName: string) {
  if (edge === true) return ''

  return `
const { warnEnvConflicts } = require('${runtimeBase}/${runtimeName}')

warnEnvConflicts({
    rootEnvPath: config.relativeEnvPaths.rootEnvPath && path.resolve(config.dirname, config.relativeEnvPaths.rootEnvPath),
    schemaEnvPath: config.relativeEnvPaths.schemaEnvPath && path.resolve(config.dirname, config.relativeEnvPaths.schemaEnvPath)
})`
}
