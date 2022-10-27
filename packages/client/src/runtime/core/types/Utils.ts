export type EmptyObjectToUnknown<T> = T extends unknown ? ({} extends T ? unknown : T) : never

export type EmptyToUnknown<T> = [T] extends [never] ? unknown : T

export type PatchDeepObject<O1, O2, O = O1 & O2> = {
  /* eslint-disable prettier/prettier */
  [K in keyof O]:
    K extends keyof O1
    ? K extends keyof O2
      ? O1[K] extends object
        ? O2[K] extends object
          ? O1[K] extends Function
            ? O1[K]
            : O2[K] extends Function
              ? O1[K]
              : PatchDeepObject<O1[K], O2[K]>
          : O1[K]
        : O1[K]
      : O1[K]
    : O2[K & keyof O2]
    /* eslint-enable */
}

export type PatchFlat<O1, O2, O = O1 & O2> = {
  /* eslint-disable prettier/prettier */
    [K in keyof O]:
    K extends keyof O1
    ? O1[K]
    : O2[K & keyof O2]
    /* eslint-enable */
}
