# 기준 영수증 사진을 일부러 돌린 시험 세트를 만든다 (영수증이 누워 찍힌 경우 인식 점검용).
# 사용: python scripts/make-rotated-fixtures.py [기준자료폴더=tests/fixtures/reference]
# 결과: <폴더>/rot90, rot180, rot270 (각각 시계 방향으로 그만큼 돌려야 바로 서는 사진)
#       <폴더>/answers-rotated.json (사진마다 0/90/180/270 중 하나를 섞어 고른 정답표)
# 기준자료 폴더는 .gitignore 대상이라 만든 파일도 올라가지 않는다.
import json
import sys
from pathlib import Path

from PIL import Image

ROT_CYCLE = [90, 270, 180, 0]

ref = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/reference")
answers = json.loads((ref / "answers.json").read_text(encoding="utf-8"))
for k in (90, 180, 270):
    (ref / f"rot{k}").mkdir(exist_ok=True)

mixed = []
for i, a in enumerate(answers):
    src = Image.open(ref / a["file"])
    for k in (90, 180, 270):
        # PIL의 rotate는 반시계 방향 → 반시계로 k도 돌린 사진은 시계 방향으로 k도 돌려야 바로 선다
        src.rotate(k, expand=True).save(ref / f"rot{k}" / a["file"], quality=92)
    k = ROT_CYCLE[i % len(ROT_CYCLE)]
    mixed.append({**a, "base": a["file"], "rotation": k, "file": a["file"] if k == 0 else f"rot{k}/{a['file']}"})

(ref / "answers-rotated.json").write_text(json.dumps(mixed, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{len(answers)}장 → rot90/rot180/rot270, 섞은 정답표 {len(mixed)}건")
