import { computeSchemaHeader } from '../../_utils/computeSchemaHeader'
import { idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, providerFlavor }): string => {
  let url
  if (provider === 'sqlite') {
    url = `env("DATABASE_URI_sqlite")`
  }

  const schemaHeader = computeSchemaHeader({
    provider,
    providerFlavor,
    url,
  })

  return /* Prisma */ `
${schemaHeader}
  
  model User {
    id ${idForProvider(provider)}
  }
  `
})
