/** 설계서 §8.2 페이지 배치. 모든 단위는 mm, 좌표는 페이지 왼쪽 위 기준. */

export interface PageSpec {
  pageW: number;
  pageH: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
  titleH: number;
  rowH: number;
  tableGap: number;
  cols: number;
  colGap: number;
  rowGap: number;
  minPhotoW: number;
}

export const DEFAULT_SPEC: PageSpec = {
  pageW: 210,
  pageH: 297,
  marginX: 15,
  marginTop: 20,
  marginBottom: 15,
  titleH: 16,
  rowH: 9,
  tableGap: 8,
  cols: 2,
  colGap: 6,
  rowGap: 6,
  minPhotoW: 45,
};

export interface LayoutReceipt {
  id: string;
  date: string | null;
  /** aspect = 높이/너비 */
  photos: { photoId: string; aspect: number }[];
}

export interface PlacedPhoto {
  receiptId: string;
  photoId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Page {
  receiptIds: string[];
  tableTop: number;
  photos: PlacedPhoto[];
}

const EPS = 1e-6;

const contentH = (s: PageSpec) => s.pageH - s.marginTop - s.marginBottom - s.titleH;
const colWidth = (s: PageSpec) => (s.pageW - 2 * s.marginX - s.colGap * (s.cols - 1)) / s.cols;

/** 건 n개일 때 사진 영역 높이 */
export function photoArea(n: number, s: PageSpec = DEFAULT_SPEC): number {
  return contentH(s) - n * 2 * s.rowH - s.tableGap;
}

interface Cell {
  receiptId: string;
  photoId: string;
  w: number;
  h: number;
}

/** 사진들을 2열 격자에 놓는다. 들어가지 않으면 null. allowSmall이면 최소 너비를 무시하고 전체를 줄여서라도 넣는다. */
function arrange(list: LayoutReceipt[], area: number, s: PageSpec, allowSmall: boolean): Cell[][] | null {
  const colW = colWidth(s);
  const cells: Cell[] = [];
  for (const r of list)
    for (const p of r.photos) {
      let w = colW;
      let h = w * p.aspect;
      if (h > area) {
        h = area;
        w = h / p.aspect;
      }
      if (w < s.minPhotoW - EPS && !allowSmall) return null;
      cells.push({ receiptId: r.id, photoId: p.photoId, w, h });
    }
  const rows: Cell[][] = [];
  for (let i = 0; i < cells.length; i += s.cols) rows.push(cells.slice(i, i + s.cols));
  const total = rows.reduce((a, row) => a + Math.max(...row.map((c) => c.h)), 0) + s.rowGap * Math.max(0, rows.length - 1);
  if (total <= area + EPS) return rows;
  // 넘치면 줄 간격을 뺀 높이에 맞춰 일괄 축소. 최소 너비 아래로 내려가면 실패(단독 건은 예외).
  const gaps = s.rowGap * Math.max(0, rows.length - 1);
  const k = Math.max(0, area - gaps) / (total - gaps);
  const scaled = rows.map((row) => row.map((c) => ({ ...c, w: c.w * k, h: c.h * k })));
  if (!allowSmall && scaled.some((row) => row.some((c) => c.w < s.minPhotoW - EPS))) return null;
  return scaled;
}

function fits(list: LayoutReceipt[], s: PageSpec): boolean {
  const area = photoArea(list.length, s);
  return area > 0 && arrange(list, area, s, false) !== null;
}

function render(list: LayoutReceipt[], s: PageSpec): Page {
  const area = photoArea(list.length, s);
  const rows = arrange(list, area, s, false) ?? arrange(list, area, s, true)!;
  const tableTop = s.marginTop + s.titleH;
  const colW = colWidth(s);
  let y = tableTop + list.length * 2 * s.rowH + s.tableGap;
  const photos: PlacedPhoto[] = [];
  for (const row of rows) {
    row.forEach((c, col) => {
      const cellX = s.marginX + col * (colW + s.colGap);
      photos.push({ receiptId: c.receiptId, photoId: c.photoId, x: cellX + (colW - c.w) / 2, y, w: c.w, h: c.h });
    });
    y += Math.max(...row.map((c) => c.h)) + s.rowGap;
  }
  return { receiptIds: list.map((r) => r.id), tableTop, photos };
}

/** 입력은 이미 정렬된 영수증. 순서를 유지하며 날짜 묶음 → 합치기 → 건 단위 나누기 순으로 채운다. */
export function paginate(receipts: LayoutReceipt[], spec: PageSpec = DEFAULT_SPEC): Page[] {
  const groups: LayoutReceipt[][] = [];
  for (const r of receipts) {
    const last = groups[groups.length - 1];
    if (last && last[0].date === r.date) last.push(r);
    else groups.push([r]);
  }

  const pages: LayoutReceipt[][] = [];
  let cur: LayoutReceipt[] = [];
  const flush = () => {
    if (cur.length) pages.push(cur);
    cur = [];
  };

  for (const g of groups) {
    if (fits([...cur, ...g], spec)) {
      cur.push(...g);
      continue;
    }
    flush();
    if (fits(g, spec)) {
      cur = [...g];
      continue;
    }
    for (const r of g) {
      if (fits([...cur, r], spec)) {
        cur.push(r);
        continue;
      }
      flush();
      if (fits([r], spec)) cur = [r];
      else pages.push([r]); // 단독 페이지, 최소 크기 예외
    }
  }
  flush();
  return pages.map((p) => render(p, spec));
}
