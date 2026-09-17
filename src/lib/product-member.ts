// optionName is also used for channel/card variants. Normalize the member view
// without discarding the original option, A/B suffixes, or benefit names.
const members = ["Bang Chan", "Lee Know", "Changbin", "Hyunjin", "Han", "Felix", "Seungmin", "I.N", "RM", "Jin", "SUGA", "J-Hope", "Jimin", "V", "Jungkook", "Unit"];

export function productMember(value?: string | null) {
  const original = value?.trim() ?? "";
  const found = members.filter((member) => {
    const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i").test(original);
  });
  return found.length === 1 ? found[0] : original;
}

export function memberOptions(values: Array<string | null | undefined>) {
  return [...new Set(values.map(productMember).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function memberFilter(value: string) {
  const member = productMember(value);
  // Whole space-delimited tokens prevent Jin matching Hyunjin or Jimin.
  return { OR: [
    { optionName: { equals: member, mode: "insensitive" as const } },
    { optionName: { startsWith: `${member} `, mode: "insensitive" as const } },
    { optionName: { endsWith: ` ${member}`, mode: "insensitive" as const } },
    { optionName: { contains: ` ${member} `, mode: "insensitive" as const } },
  ] };
}
