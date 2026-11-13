"""참고 PDF에서 정확도 점검용 기준 자료를 만든다.

사용: python scripts/extract-fixtures.py <참고 PDF> [출력 폴더=tests/fixtures/reference]
필요: PyMuPDF (pip install pymupdf)

- 영수증이 붙은 쪽(표 2행 + 사진 좌우 2장)을 렌더해서 사진 영역을 좌/우로 잘라
  p{쪽}-L.jpg, p{쪽}-R.jpg로 저장한다. 표의 첫 건이 왼쪽, 둘째 건이 오른쪽이다.
- 카드사 승인내역(1~2쪽)의 글자를 읽어 statement.json(일자·금액·가맹점·승인번호)으로 저장하고,
  answers.json이 있으면 비어 있는 merchant/approvalNo를 일자+금액으로 찾아 채운다.

출력 폴더에는 카드번호 일부와 이름이 들어가므로 .gitignore에 들어 있어야 한다.
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

# 영수증 사진이 붙은 쪽. 7~9쪽은 진료 서류 첨부라 제외한다.
RECEIPT_PAGES = [3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18]
# 쪽 렌더 기준 비율: 사진 영역의 세로 범위와 좌/우 가로 범위
PHOTO_Y = (0.25, 0.985)
LEFT_X = (0.02, 0.50)
RIGHT_X = (0.50, 0.98)
DPI = 200


def crop(pix, x, y):
    ir = pymupdf.IRect(int(pix.width * x[0]), int(pix.height * y[0]), int(pix.width * x[1]), int(pix.height * y[1]))
    out = pymupdf.Pixmap(pix.colorspace, ir, False)
    out.copy(pix, ir)
    out.set_origin(0, 0)
    return out


def extract_photos(doc, out: Path):
    for n in RECEIPT_PAGES:
        pix = doc[n - 1].get_pixmap(dpi=DPI)
        for side, x in (("L", LEFT_X), ("R", RIGHT_X)):
            crop(pix, x, PHOTO_Y).save(str(out / f"p{n}-{side}.jpg"), jpg_quality=88)
        print(f"p{n}: L, R")


AMOUNT = re.compile(r"^\d{1,3}(,\d{3})+$")
ENTRY = re.compile(r"^(\d{2})\.(\d{2}) \d{2}:\d{2}$")


def parse_statement(doc, year: str):
    lines = [l.strip() for i in (0, 1) for l in doc[i].get_text().splitlines()]
    rows = []
    for i, line in enumerate(lines):
        m = ENTRY.match(line)
        if not m:
            continue
        approval, merchant = lines[i + 1], lines[i + 3]
        amount = next((l for l in lines[i + 4 : i + 12] if AMOUNT.match(l)), None)
        if amount:
            rows.append(
                {
                    "date": f"{year}-{m.group(1)}-{m.group(2)}",
                    "amount": int(amount.replace(",", "")),
                    "merchant": merchant.replace("　", " "),
                    "approvalNo": approval,
                }
            )
    return rows


def main():
    pdf = sys.argv[1]
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "tests/fixtures/reference")
    out.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)
    extract_photos(doc, out)

    rows = parse_statement(doc, "2026")
    (out / "statement.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"statement: {len(rows)} rows")

    answers_path = out / "answers.json"
    if answers_path.exists():
        answers = json.loads(answers_path.read_text(encoding="utf-8"))
        used = set()
        for a in answers:
            for k, r in enumerate(rows):
                if k not in used and r["date"] == a["date"] and r["amount"] == a["amount"]:
                    a.setdefault("merchant", r["merchant"])
                    a.setdefault("approvalNo", r["approvalNo"])
                    used.add(k)
                    break
        answers_path.write_text(json.dumps(answers, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"answers: {sum('merchant' in a for a in answers)}/{len(answers)} merchants matched")


if __name__ == "__main__":
    main()
