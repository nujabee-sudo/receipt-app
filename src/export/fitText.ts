export type Measure = (s: string, size: number) => number;

/** 셀 너비에 맞춰 글자를 size→minSize로 줄이고, 그래도 넘치면 줄을 나눈다. maxLines를 넘으면 마지막 줄을 '…'로 자른다. */
export function fitText(
  text: string,
  maxWidth: number,
  measure: Measure,
  opts: { size?: number; minSize?: number; maxLines?: number } = {},
): { size: number; lines: string[] } {
  const { size = 10, minSize = 8, maxLines = 2 } = opts;
  for (let s = size; s >= minSize; s--) if (measure(text, s) <= maxWidth) return { size: s, lines: [text] };

  const s = minSize;
  const fits = (t: string) => measure(t, s) <= maxWidth;
  const lines: string[] = [];
  let cur = '';
  const pushWord = (word: string) => {
    const candidate = cur ? `${cur} ${word}` : word;
    if (fits(candidate)) {
      cur = candidate;
      return;
    }
    if (cur) lines.push(cur);
    cur = '';
    if (fits(word)) {
      cur = word;
      return;
    }
    // 공백 없는 긴 단어는 글자 단위로 나눈다
    let piece = '';
    for (const ch of word) {
      if (fits(piece + ch)) piece += ch;
      else {
        lines.push(piece);
        piece = ch;
      }
    }
    cur = piece;
  };
  for (const w of text.split(/\s+/).filter(Boolean)) pushWord(w);
  if (cur) lines.push(cur);

  if (lines.length <= maxLines) return { size: s, lines };
  const kept = lines.slice(0, maxLines - 1);
  let last = lines.slice(maxLines - 1).join(' ');
  while (last && !fits(`${last}…`)) last = last.slice(0, -1);
  kept.push(`${last.trimEnd()}…`);
  return { size: s, lines: kept };
}
