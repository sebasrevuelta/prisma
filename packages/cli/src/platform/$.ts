import { Command, Commands } from '@prisma/internals'

import { EarlyAccessFlagError } from '../../../migrate/src/utils/flagErrors'

export class $ implements Command {
  public static new(commands: Commands): $ {
    return new $(commands)
  }

  private constructor(private readonly commands: Commands) {}

  public async parse(argv: string[]) {
    const isHasEarlyAccessFeatureFlag = Boolean(argv.find((_) => _.match(/early-access-feature/)))
    if (!isHasEarlyAccessFeatureFlag) throw new EarlyAccessFlagError()

    await Promise.resolve('todo')

    return ''
  }
}
