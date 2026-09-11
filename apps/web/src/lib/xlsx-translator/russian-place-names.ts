// Verified Russian place spellings, not a blanket transliteration rule.
// Both the source place + administrative marker and the Russian destination
// context must match. Never treat remaining Uzbek prose as translated.
// References:
// https://gov.uz/ru/chiroqchi/contacts
// https://gov.uz/ru/margilan/contacts
// https://gov.uz/ru/bostonliq/contacts
const wordStart = "(?<![\\p{L}\\p{N}_./:+-])";
const wordEnd = "(?![\\p{L}\\p{N}_./:+-])";
const adjective =
  "(ский|ского|скому|ским|ском|ская|ской|ское|ские|ских|скими|скую)";
const district = "(?=\\s+район(?:а|е|у|ом|ы|ов|ам|ами|ах)?" + wordEnd + ")";
const districtRules = [
  {
    source: new RegExp(wordStart + "Chiroqchi\\s+tuman(?:i)?" + wordEnd, "iu"),
    candidate: new RegExp(wordStart + "Чироқчин" + adjective + district, "giu"),
    russianStem: "Чиракчин",
  },
  {
    source: new RegExp(wordStart + "Bo'stonliq\\s+tuman(?:i)?" + wordEnd, "iu"),
    candidate: new RegExp(
      wordStart + "Бўстонлиқ" + adjective + district,
      "giu",
    ),
    russianStem: "Бостанлык",
  },
];
const margilanSource = new RegExp(
  wordStart + "Marg'ilon\\s+(?:shahri|shahar)" + wordEnd,
  "iu",
);
const margilanCandidate = new RegExp(
  "(" + wordStart + "город(?:а|у|е|ом)?\\s+)Марғилон(а|у|е|ом)?" + wordEnd,
  "giu",
);

export function normalizeKnownRussianPlaceNames(
  source: string,
  text: string,
): string {
  const normalizedSource = source.replace(/[‘’ʻʼ`´]/g, "'");
  let result = text;
  for (const rule of districtRules) {
    if (rule.source.test(normalizedSource))
      result = result.replace(
        rule.candidate,
        (_word, ending: string) => rule.russianStem + ending.toLowerCase(),
      );
  }
  if (margilanSource.test(normalizedSource))
    result = result.replace(
      margilanCandidate,
      (_word, context: string, ending?: string) =>
        context + "Маргилан" + (ending?.toLowerCase() || ""),
    );
  return result;
}
