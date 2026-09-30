/**
 * What the browser imports, and what the stubbed model answers with. Invented,
 * like every fixture here — nothing is sampled from `local/`.
 */
export const CLAIM_SENTENCE =
  "Rewriting the row-by-row loop as a set-based update cut the overnight settlement job from eight hours to fifty minutes.";

export const CLAIM = "Cut the overnight settlement job from eight hours to fifty minutes";

export const SOURCE_FILENAME = "meridian-settlement.md";

export const SOURCE_TEXT = `# Meridian nightly settlement

The overnight settlement job had grown to eight hours and regularly overran into the business day.

${CLAIM_SENTENCE}
`;

/** Every value is invented. The form wants a whole profile before anything else opens. */
export const PROFILE = {
  "姓 · Family name": "青木",
  "名 · Given name": "陽介",
  "せい · Family name (kana)": "あおき",
  "めい · Given name (kana)": "ようすけ",
  "Name in Latin script": "Yosuke Aoki",
  "生年月日 · Date of birth": "1994-11",
  "電話番号 · Phone": "080-0000-0000",
  "メールアドレス · Email": "yosuke@example.invalid",
  "郵便番号 · Postal code": "150-0001",
  "住所 · Address": "東京都渋谷区神宮前0-0-0",
  "ふりがな · Address (kana)": "とうきょうと しぶやく じんぐうまえ",
};
