import { defineMatrix } from '../_utils/defineMatrix'
import { ProviderFlavors } from '../_utils/providerFlavors'

export default defineMatrix(() => [
  [
    {
      provider: 'postgresql',
    },
    {
      provider: 'postgresql',
      providerFlavor: ProviderFlavors.PG,
    },
    {
      provider: 'postgresql',
      providerFlavor: ProviderFlavors.JS_NEON,
    },
  ],
])
