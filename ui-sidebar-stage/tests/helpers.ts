/** Test helper: the locale service's bind contract as a plain dictionary read. */
export function makeTranslate<T extends Record<string, string>>(dict: T): (key: string) => string {
  return key => {
    const value = dict[key as keyof T]
    if (value === undefined) throw new Error(`missing dictionary key: ${key}`)
    return value
  }
}
