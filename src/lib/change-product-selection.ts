export function parseChangeSkus(text: string) {
  return [...new Set(text.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean))];
}

export function selectChangedProducts<T>(rows: T[], ids: string[] | undefined, getId: (row: T) => string) {
  if (ids === undefined) return rows;
  const selected = new Set(ids);
  return rows.filter(row => selected.has(getId(row)));
}
