import { parseFeaturedMembers } from "@/lib/ebay-listing-fields";
import { normalizeMatchText } from "@/lib/product-matching";

// eBay 리스팅 제목이 "우리 상품과 같은 카드"인지 판정한다.
//
// 포토카드는 그룹 이름과 흔한 낱말(Official, Photocard, Ver.)이 모든 카드에 똑같이
// 들어가서, 글자가 겹치는지만 보면 멤버도 앨범도 다른 카드가 같은 카드로 보인다.
// 게다가 eBay 판매자마다 표기가 제각각이라("Lee Know" / "LeeKnow" / "Minho",
// "Apple Music" / "APPLEMUSIC") 낱말 비교만으로는 맞는 카드를 놓친다.
//
// 그래서 세 가지를 순서대로 본다.
//   1) 그룹이 같은가            — 다르면 볼 것도 없다.
//   2) 그 멤버 한 명의 카드인가 — 다른 멤버가 함께 적힌 "멤버 골라 담기" 리스팅은
//                                 값이 싸서 최저가 자리를 차지하지만 같은 카드가 아니다.
//   3) 앨범·이벤트가 같은가     — 같은 멤버라도 발매처가 다르면 시세가 몇 배 차이 난다.
//
// 판정은 후보를 거르고 등급을 매길 뿐이며, 가격 채택은 화면에서 사람이 한다
// (docs/business-rules.md 가격 계산).

export type PhotocardMatchTier = "exact" | "similar" | "rejected";

export type PhotocardTitleMatch = {
  tier: PhotocardMatchTier;
  // 앨범·이벤트 이름이 제목에 얼마나 남아 있는지(0~1). 등급의 근거다.
  albumCoverage: number;
  // 왜 이 등급인지 한 줄. 화면에서 사람이 판단할 때 그대로 보여준다.
  reason: string;
};

export type PhotocardMatchProduct = {
  brand?: string | null;
  category?: string | null;
  optionName?: string | null;
  productName?: string | null;
  featuredMembers?: string | null;
};

// 유닛·단체 카드는 optionName이 멤버 이름이 아니므로 멤버 판정에서 제외한다.
const NON_MEMBER_OPTION_NAMES = new Set(["unit", "group", "all", "ot8", "ot9"]);

// eBay 제목이 그룹 이름 대신 줄임말만 쓰는 경우가 흔하다.
const GROUP_ALIASES = new Map<string, string[]>([
  ["stray kids", ["skz", "straykids"]],
  ["le sserafim", ["lesserafim"]],
  ["riize", ["rize"]],
]);

type RosterMember = {
  // 상품의 optionName과 맞춰 볼 대표 이름.
  name: string;
  // 이 표기가 제목에 있으면 그 멤버의 카드로 본다. "다른 멤버가 섞였는지" 판정도
  // 이 목록으로 한다. 그래서 다른 낱말과 헷갈릴 표기는 여기 넣지 않는다.
  names: string[];
  // 우리 상품의 멤버를 찾을 때만 쓰는 표기. 애칭이나 성 없이 부르는 이름처럼
  // 다른 멤버 이름 안에 우연히 들어갈 수 있어("Chan"은 "Changbin" 안에 있다)
  // 다른 멤버 판정에는 쓰지 않는다.
  looseNames: string[];
};

// 지금 취급하는 그룹의 멤버 표기. 여기 없는 그룹은 optionName만으로 판정한다.
const GROUP_ROSTERS = new Map<string, RosterMember[]>([
  [
    "stray kids",
    [
      { name: "BANG CHAN", names: ["bang chan", "bangchan"], looseNames: ["chan", "chris bang", "christopher bang"] },
      { name: "LEE KNOW", names: ["lee know", "leeknow", "minho", "lee minho"], looseNames: [] },
      { name: "CHANGBIN", names: ["changbin", "seo changbin"], looseNames: [] },
      { name: "HYUNJIN", names: ["hyunjin", "hwang hyunjin"], looseNames: [] },
      { name: "HAN", names: ["han", "jisung", "han jisung"], looseNames: [] },
      { name: "FELIX", names: ["felix", "lee felix"], looseNames: ["yongbok"] },
      { name: "SEUNGMIN", names: ["seungmin", "kim seungmin"], looseNames: [] },
      { name: "I.N", names: ["i n", "jeongin", "yang jeongin"], looseNames: ["innie"] },
    ],
  ],
]);

// 포토카드 리스팅이면 거의 반드시 들어가는 말. 하나도 없으면 앨범·굿즈·사은품
// 리스팅이라 시세 기준으로 쓸 수 없다.
const CARD_PHRASES = ["photocard", "photo card", "trading card", "tradingcard", "pc", "pcs"];

// 같은 카드 한 장의 가격이 아니어서 최저가 기준으로 쓰면 안 되는 리스팅.
// 우리 상품 이름에 이미 들어 있는 말로는 거르지 않는다("Photo Card Set" 상품처럼
// 그 말 자체가 우리 카드의 이름인 경우가 있다).
const NOT_A_SINGLE_CARD_PHRASES = [
  "set of",
  "lot of",
  "full set",
  "complete set",
  "whole set",
  "pack of",
  "bundle",
  "all members",
  "ot8",
  "ot9",
  "choose",
  "choice",
  "you pick",
  "pick your",
  "select your",
  "random",
];

// 카드가 아니라 카드를 담는 물건이거나 비공식 인쇄물인 리스팅.
const NOT_A_CARD_PHRASES = [
  "sleeve",
  "sleeves",
  "toploader",
  "top loader",
  "binder",
  "protector",
  "keyring",
  "keychain",
  "poster",
  "sticker",
  "plushie",
  "lightstick",
  "hoodie",
  "custom",
  "fanmade",
  "unofficial",
  "reprint",
  "replica",
  "digital",
];

// 앨범·이벤트 이름을 비교할 때 무시할 낱말. 어느 카드에나 들어가서 겹쳐도
// 같은 카드라는 근거가 되지 않는다.
const COMMON_WORDS = new Set([
  "ver",
  "version",
  "official",
  "photocard",
  "photocards",
  "photo",
  "card",
  "cards",
  "pc",
  "pcs",
  "trading",
  "kpop",
  "k",
  "pop",
  "the",
  "and",
  "with",
  "for",
  "of",
  "a",
  "an",
  "in",
  "on",
  "new",
  "sealed",
  "authentic",
  "genuine",
  "rare",
  "korea",
  "korean",
  "japan",
  "japanese",
  "free",
  "shipping",
  "ship",
  "ships",
  "us",
  "usa",
  "seller",
  "fast",
  "mint",
  "nm",
]);

// 같은 앨범이라도 발매처·버전이 다르면 다른 카드이고 시세도 다르다. 카탈로그에
// 실제로 쓰이는 발매처·특전 표시를 모아 뒀다. 우리 카드에 없는 표시가 제목에
// 있으면 확신 후보로 올리지 않는다.
const EDITION_MARKERS = [
  "sound wave",
  "soundwave",
  "lucky draw",
  "withmuu",
  "ktown4u",
  "aladin",
  "yes24",
  "makestar",
  "apple music",
  "applemusic",
  "music korea",
  "musickorea",
  "mymusictaste",
  "everline",
  "powerstation",
  "hmv",
  "tower records",
  "sony music",
  "jyp shop",
  "kms",
  "yizhiyu",
  "nacific",
  "weverse",
  "nemoz",
  "dicon",
  "starriver",
  "star river",
  "broadcast",
  "fansign",
  "pob",
  "polaroid",
  "blu ray",
];

// 띄어쓰기를 무시하고 붙여 읽으려면 이 길이 이상이어야 한다.
const MERGED_MIN_LENGTH = 5;

// 앨범 이름이 길수록 eBay 제목에는 일부만 들어간다. 낱말 하나가 가지는 무게에
// 상한을 둬, 긴 낱말 하나가 짧은 낱말 여럿을 덮어버리지 않게 한다.
const MAX_TOKEN_WEIGHT = 8;

// eBay 제목도 80자 한도라 긴 앨범 이름은 판매자도 뒤를 자른다. 앞쪽 낱말만으로
// 판정해야 잘린 제목을 놓치지 않는다.
const KEY_ALBUM_TOKEN_COUNT = 5;

// 앨범 이름의 앞머리로 볼 낱말 수. 포카마켓 분류는 "앨범 이름 + 발매처" 순서다.
const ALBUM_HEAD_TOKEN_COUNT = 2;

const EXACT_ALBUM_COVERAGE = 0.6;
const SIMILAR_ALBUM_COVERAGE = 0.3;

function tokensOf(value: string | null | undefined) {
  return normalizeMatchText(value).split(" ").filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function tokenWeight(token: string) {
  return Math.min(token.length, MAX_TOKEN_WEIGHT);
}

// 낱말이 순서대로 이어져 있으면 찾은 것으로 본다. 띄어쓰기 차이는 무시하되
// ("Lee Know" = "LeeKnow", "APPLEMUSIC" = "Apple Music") 반드시 낱말의 시작과
// 끝에 맞아떨어져야 한다. 낱말 중간까지 허용하면 "SEUNGMIN HOP"이 "MINHO"로,
// "CARD SET Official"이 "SET OF"로 읽히는 사고가 난다.
function containsPhrase(tokens: string[], phrase: string) {
  const target = tokensOf(phrase);
  if (!target.length || !tokens.length) return false;

  const joined = target.join("");

  for (let start = 0; start < tokens.length; start += 1) {
    if (target.every((part, offset) => tokens[start + offset] === part)) {
      return true;
    }

    // 붙여 쓴 표기는 이어지는 낱말을 합쳤을 때 통째로 같아야 인정한다.
    // 짧은 이름까지 이렇게 보면 "I.N"이 "IN LIFE"의 in과 같아져 버린다.
    if (joined.length < MERGED_MIN_LENGTH) continue;

    let merged = "";
    for (let end = start; end < tokens.length; end += 1) {
      merged += tokens[end];
      if (merged.length > joined.length) break;
      if (merged === joined) return true;
    }
  }
  return false;
}

export function groupNames(brand: string | null | undefined) {
  const name = String(brand ?? "").trim();
  if (!name) return [];
  return unique([name, ...(GROUP_ALIASES.get(normalizeMatchText(name)) ?? [])]);
}

function rosterOf(brand: string | null | undefined) {
  return GROUP_ROSTERS.get(normalizeMatchText(brand)) ?? [];
}

// 이 상품이 어느 멤버의 카드인지. 유닛 카드는 지정된 실제 멤버가 있을 때만 알 수 있다.
export function productMemberNames(product: PhotocardMatchProduct) {
  const featured = parseFeaturedMembers(product.featuredMembers);
  if (featured.length) return featured;

  const option = product.optionName?.trim();
  if (!option || NON_MEMBER_OPTION_NAMES.has(option.toLowerCase())) return [];
  return [option];
}

function rosterEntryFor(roster: RosterMember[], memberName: string) {
  const normalized = normalizeMatchText(memberName);
  return roster.find(
    (member) =>
      normalizeMatchText(member.name) === normalized ||
      member.names.some((name) => normalizeMatchText(name) === normalized),
  );
}

// 한 멤버를 제목에서 찾을 때 쓸 모든 표기.
function memberSearchNames(product: PhotocardMatchProduct) {
  const roster = rosterOf(product.brand);
  return unique(
    productMemberNames(product).flatMap((name) => {
      const entry = rosterEntryFor(roster, name);
      return entry ? [name, ...entry.names, ...entry.looseNames] : [name];
    }),
  );
}

// 검색어에 쓸 멤버 이름. 우리가 가진 이름("LEE KNOW", "I.N")이 곧 eBay 제목이
// 쓰는 활동명이므로 그대로 쓴다. 다른 표기(Minho 등)는 받아 온 결과를 판정할
// 때만 쓴다. 검색어에 넣으면 그 표기를 쓴 리스팅만 남아 오히려 결과가 줄어든다.
export function memberQueryName(product: PhotocardMatchProduct) {
  return productMemberNames(product)[0] ?? "";
}

// 앨범·이벤트를 가리키는 낱말만 남긴다. 그룹 이름과 멤버 이름은 어차피 따로
// 검사하므로 빼야 "겹쳤다"는 착시가 생기지 않는다.
export function albumTokens(product: PhotocardMatchProduct) {
  const excluded = new Set([
    ...groupNames(product.brand).flatMap(tokensOf),
    ...memberSearchNames(product).flatMap(tokensOf),
  ]);

  return unique(
    tokensOf(product.category).filter(
      (token) =>
        !COMMON_WORDS.has(token) &&
        !excluded.has(token) &&
        // 두 글자 이하의 낱말은 어느 제목에나 있어 같은 카드라는 근거가 못 된다.
        // 연도나 "5-STAR"의 5처럼 숫자는 카드를 가르는 값이므로 남긴다.
        (token.length > 2 || /^\d+$/.test(token)),
    ),
  );
}

// 검색어에 넣을 앨범 낱말. 적힌 순서를 지킨다. 포카마켓의 분류는 "앨범 이름 +
// 발매처·이벤트" 순서라, 앞쪽 낱말일수록 카드를 넓게 그리고 정확하게 좁힌다.
export function albumQueryTokens(product: PhotocardMatchProduct) {
  return albumTokens(product);
}

function ownProductTokens(product: PhotocardMatchProduct) {
  return [product.productName, product.category, product.optionName].flatMap((value) =>
    tokensOf(value),
  );
}

function rejected(reason: string, albumCoverage = 0): PhotocardTitleMatch {
  return { tier: "rejected", albumCoverage, reason };
}

// 앨범 낱말 중 제목에 남아 있는 것을 고른다. 이어지는 두 낱말이 제목에서는 한
// 낱말로 붙어 있는 경우("SOUND WAVE" = "Soundwave")까지 같이 본다.
function matchedAlbumTokens(album: string[], titleTokens: string[]) {
  const matched = album.map((token) => containsPhrase(titleTokens, token));

  for (let index = 0; index < album.length - 1; index += 1) {
    if (matched[index] && matched[index + 1]) continue;
    if (containsPhrase(titleTokens, `${album[index]} ${album[index + 1]}`)) {
      matched[index] = true;
      matched[index + 1] = true;
    }
  }

  return matched;
}

export function analyzePhotocardTitleMatch(
  product: PhotocardMatchProduct,
  listingTitle: string,
): PhotocardTitleMatch {
  const tokens = tokensOf(listingTitle);
  if (!tokens.length) {
    return rejected("제목을 읽을 수 없습니다.");
  }

  const has = (phrase: string) => containsPhrase(tokens, phrase);

  const groups = groupNames(product.brand);
  if (groups.length && !groups.some(has)) {
    return rejected("다른 그룹의 카드입니다.");
  }

  // 우리 상품 이름에 이미 들어 있는 말로는 거르지 않는다. "Random trading card"나
  // "Photo Card Set"처럼 그 말 자체가 우리 카드의 이름인 상품이 있다.
  const own = ownProductTokens(product);
  const ownHas = (phrase: string) => containsPhrase(own, phrase);

  const notACard = NOT_A_CARD_PHRASES.find((phrase) => has(phrase) && !ownHas(phrase));
  if (notACard) {
    return rejected("카드가 아닌 물건이거나 비공식 인쇄물입니다.");
  }

  if (!CARD_PHRASES.some(has)) {
    return rejected("포토카드 리스팅이 아닙니다.");
  }

  const notSingle = NOT_A_SINGLE_CARD_PHRASES.find(
    (phrase) => has(phrase) && !ownHas(phrase),
  );
  if (notSingle) {
    return rejected("한 장의 값이 아닌 묶음·랜덤·멤버 선택 리스팅입니다.");
  }

  const roster = rosterOf(product.brand);
  const expectedMembers = productMemberNames(product);

  if (expectedMembers.length) {
    if (!memberSearchNames(product).some(has)) {
      return rejected("다른 멤버의 카드입니다.");
    }

    // 다른 멤버 이름이 함께 적혀 있으면 "멤버 골라 담기"거나 여러 장을 한 번에
    // 파는 리스팅이다. 값이 싸서 그냥 두면 최저가 자리를 차지한다.
    const expectedEntries = expectedMembers
      .map((name) => rosterEntryFor(roster, name))
      .filter((entry): entry is RosterMember => Boolean(entry));
    const foreign = roster.filter(
      (member) =>
        !expectedEntries.includes(member) && member.names.some((name) => has(name)),
    );
    if (foreign.length) {
      return rejected("여러 멤버가 함께 있는 리스팅입니다.");
    }
  }

  const album = albumTokens(product);
  if (!album.length) {
    if (!expectedMembers.length) {
      return rejected("멤버도 앨범도 확인할 수 없습니다.");
    }
    return {
      tier: "similar",
      albumCoverage: 0,
      reason: "같은 멤버지만 이 상품에 앨범 정보가 없어 확인이 필요합니다.",
    };
  }

  const keyAlbum = album.slice(0, KEY_ALBUM_TOKEN_COUNT);
  const matched = matchedAlbumTokens(keyAlbum, tokens);
  const totalWeight = keyAlbum.reduce((sum, token) => sum + tokenWeight(token), 0);
  const matchedWeight = keyAlbum.reduce(
    (sum, token, index) => sum + (matched[index] ? tokenWeight(token) : 0),
    0,
  );
  const albumCoverage = totalWeight ? Number((matchedWeight / totalWeight).toFixed(3)) : 0;
  const missingCount = matched.filter((found) => !found).length;
  // 이름이 길면 판매자가 뒤를 자르므로 하나까지는 빠져도 같은 카드로 본다.
  const allowedMissing = keyAlbum.length >= KEY_ALBUM_TOKEN_COUNT ? 1 : 0;
  // 다만 앞머리는 앨범 이름 그 자체라 빠지면 안 된다. 뒤쪽(발매처·행사)만 잘린
  // 것과, "5-STAR"와 "ROCK-STAR"처럼 앨범이 아예 다른 것을 여기서 가른다.
  const headMissing = matched.slice(0, ALBUM_HEAD_TOKEN_COUNT).some((found) => !found);

  // 우리 카드에 없는 발매처·특전 표시가 제목에 있으면 같은 앨범의 다른 버전이다.
  const otherEdition = EDITION_MARKERS.find((marker) => has(marker) && !ownHas(marker));

  if (
    albumCoverage >= EXACT_ALBUM_COVERAGE &&
    missingCount <= allowedMissing &&
    !headMissing
  ) {
    if (otherEdition) {
      return {
        tier: "similar",
        albumCoverage,
        reason: "같은 앨범이지만 발매처·특전이 달라 보입니다.",
      };
    }

    return {
      tier: "exact",
      albumCoverage,
      reason: expectedMembers.length
        ? "그룹·멤버·앨범이 모두 맞습니다."
        : "그룹과 앨범이 맞습니다.",
    };
  }

  if (albumCoverage >= SIMILAR_ALBUM_COVERAGE) {
    return {
      tier: "similar",
      albumCoverage,
      reason: otherEdition
        ? "같은 앨범이지만 발매처·특전이 달라 보입니다."
        : "앨범 이름이 일부만 맞아 다른 버전일 수 있습니다.",
    };
  }

  // 제목에 앨범을 가리키는 말이 아예 없으면 다른 앨범이라고 단정할 수 없다.
  // 반대로 다른 앨범 이름이 적혀 있으면 다른 카드로 본다.
  const albumWords = tokens.filter(
    (token) =>
      !COMMON_WORDS.has(token) &&
      !groups.some((name) => tokensOf(name).includes(token)) &&
      !roster.some((member) =>
        member.names.some((name) => tokensOf(name).includes(token)),
      ),
  );

  if (!albumWords.length && expectedMembers.length) {
    return {
      tier: "similar",
      albumCoverage,
      reason: "제목에 앨범 이름이 없어 같은 카드인지 확인이 필요합니다.",
    };
  }

  return rejected("앨범·버전이 다른 카드입니다.", albumCoverage);
}
