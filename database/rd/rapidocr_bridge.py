"""Local CPU-only RapidOCR bridge. stdout is exclusively TSV; images never leave host."""
import contextlib
import math
import os
from pathlib import Path
import sys
import warnings

TSV_HEADER = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
MAX_PIXELS = 20_000_000
MAX_SIDE = 10_000

def output_tsv(boxes, texts, scores):
    lines = [TSV_HEADER]
    if boxes is None or texts is None or scores is None:
        return "\n".join(lines) + "\n"
    if not (len(boxes) == len(texts) == len(scores)):
        raise ValueError("OCR output count mismatch")
    for index, (box, text, score) in enumerate(zip(boxes, texts, scores)):
        xs, ys = [float(p[0]) for p in box], [float(p[1]) for p in box]
        score = float(score)
        if not xs or not ys or not all(math.isfinite(v) for v in xs + ys + [score]):
            raise ValueError("Invalid OCR coordinates")
        left, top = max(0, math.floor(min(xs))), max(0, math.floor(min(ys)))
        width, height = max(1, math.ceil(max(xs)) - left), max(1, math.ceil(max(ys)) - top)
        text = str(text).replace("\t", " ").replace("\r", " ").replace("\n", " ").strip()
        if not text:
            continue
        lines.append("\t".join(map(str, [5, 1, 1, 1, index + 1, 1, left, top, width, height, min(100, max(0, score * 100)), text])))
    return "\n".join(lines) + "\n"

def check_image(path):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(path) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
                raise ValueError("Image dimensions exceed limit")
            if image.format not in {"PNG", "JPEG", "WEBP"}:
                raise ValueError("Unsupported image format")
            image.verify()

def split_crossing_cells(image, boxes, texts, scores, recognize_cell):
    """Use observed vertical grid lines to re-read merged cells; never split text by guess."""
    import cv2
    import numpy as np
    if boxes is None or texts is None or scores is None:
        return boxes, texts, scores
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    ink = cv2.threshold(grey, 230, 255, cv2.THRESH_BINARY_INV)[1]
    height, width = grey.shape
    vertical = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(40, height // 12))))
    projection = np.count_nonzero(vertical, axis=0)
    positions = np.flatnonzero(projection >= max(60, height * .2)).tolist()
    groups = []
    for x in positions:
        if not groups or x > groups[-1][-1] + 2:
            groups.append([x])
        else:
            groups[-1].append(x)
    lines = [round(sum(group) / len(group)) for group in groups]
    if len(lines) < 3:
        return boxes, texts, scores
    records = []
    for box, text, score in zip(boxes, texts, scores):
        xs, ys = [float(point[0]) for point in box], [float(point[1]) for point in box]
        records.append({'box':box, 'text':text, 'score':score, 'left':min(xs), 'right':max(xs), 'top':min(ys), 'bottom':max(ys)})
    consumed, replacements = set(), []
    for index, record in enumerate(records):
        if index in consumed:
            continue
        top, bottom = max(0, int(record['top'])), min(height, int(record['bottom']) + 1)
        crossing = [x for x in lines[1:-1] if record['left'] < x - 4 and record['right'] > x + 4 and np.count_nonzero(vertical[top:bottom, max(0, x-1):x+2]) >= (bottom-top) * .5]
        if not crossing:
            continue
        center = (record['top'] + record['bottom']) / 2
        row_ids = [i for i, candidate in enumerate(records) if candidate['right'] >= lines[0] and abs((candidate['top'] + candidate['bottom']) / 2 - center) <= max(record['bottom']-record['top'], candidate['bottom']-candidate['top']) * .45]
        affected_columns = [c for c in range(len(lines)-1) if record['right'] > lines[c] + 4 and record['left'] < lines[c+1] - 4]
        row_top = max(0, math.floor(min(records[i]['top'] for i in row_ids)) - 4)
        row_bottom = min(height, math.ceil(max(records[i]['bottom'] for i in row_ids)) + 4)
        for column in affected_columns:
            left, right = lines[column] + 2, lines[column+1] - 2
            if right <= left:
                continue
            cell = image[row_top:row_bottom, left:right]
            text, score = recognize_cell(cell)
            replacements.append(([[left,row_top],[right,row_top],[right,row_bottom],[left,row_bottom]], text, score))
            for i in row_ids:
                candidate = records[i]
                if candidate['right'] > left and candidate['left'] < right:
                    consumed.add(i)
    output = [(record['box'], record['text'], record['score']) for i, record in enumerate(records) if i not in consumed] + replacements
    if not output:
        return [], [], []
    return tuple(zip(*output))

def main():
    if len(sys.argv) != 2:
        raise ValueError("Expected one image path")
    path = Path(sys.argv[1]).resolve(strict=True)
    check_image(path)
    # Redirect model-download/progress and library logs away from the TSV protocol.
    with contextlib.redirect_stdout(sys.stderr):
        from importlib.metadata import version
        if version("rapidocr") != "3.10.0":
            raise RuntimeError("RapidOCR version mismatch")
        from rapidocr import RapidOCR, EngineType, LangDet, LangRec, ModelType, OCRVersion
        model_dir = Path(os.environ.get("RD_OCR_MODEL_DIR", "/opt/suyu-finance/ocr-models"))
        model_dir.mkdir(parents=True, exist_ok=True)
        engine = RapidOCR(params={
            "Global.model_root_dir": str(model_dir),
            "Global.use_cls": False,
            "Global.log_level": "error",
            "Global.text_score": 0.3,
            "Det.engine_type": EngineType.ONNXRUNTIME,
            "Det.lang_type": LangDet.CH,
            "Det.model_type": ModelType.MEDIUM,
            "Det.ocr_version": OCRVersion.PPOCRV6,
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": LangRec.CH,
            "Rec.model_type": ModelType.MEDIUM,
            "Rec.ocr_version": OCRVersion.PPOCRV6,
            "EngineConfig.onnxruntime.intra_op_num_threads": 2,
            "EngineConfig.onnxruntime.inter_op_num_threads": 2,
            "EngineConfig.onnxruntime.use_cuda": False,
            "EngineConfig.onnxruntime.use_dml": False,
            "EngineConfig.onnxruntime.use_coreml": False,
        })
        result = engine(str(path), use_cls=False)
        import cv2
        image = cv2.imread(str(path))
        def recognize_cell(cell):
            read = engine(cell, use_det=False, use_cls=False, use_rec=True)
            if read.txts is None or len(read.txts) != 1:
                return '', 0.0
            return read.txts[0], read.scores[0]
        boxes, texts, scores = split_crossing_cells(image, result.boxes, result.txts, result.scores, recognize_cell)
    sys.stdout.write(output_tsv(boxes, texts, scores))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Native/library errors can include private paths; expose neither data nor stack.
        print("Local image OCR could not complete.", file=sys.stderr)
        sys.exit(1)
