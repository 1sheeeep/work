import io
import subprocess
import tempfile
import warnings

from flask import Flask, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge
from PIL import Image, UnidentifiedImageError

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_DIMENSION = 8_000
MAX_TEXT_CHARS = 30_000
OCR_TIMEOUT_SECONDS = 25

Image.MAX_IMAGE_PIXELS = MAX_PIXELS
warnings.simplefilter("error", Image.DecompressionBombWarning)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BYTES


class OcrInputError(Exception):
    pass


@app.get("/health")
def health():
    return {"status": "UP"}


@app.post("/ocr")
def ocr():
    content = request.get_data(cache=False, as_text=False)
    image = safe_image(content)
    with tempfile.TemporaryDirectory(prefix="resume-ocr-", dir="/tmp") as directory:
        source = f"{directory}/source.png"
        image.save(source, format="PNG", optimize=False)
        try:
            result = subprocess.run(
                ["tesseract", source, "stdout", "--oem", "1", "-l", "chi_sim+eng", "--psm", "6"],
                check=False,
                capture_output=True,
                timeout=OCR_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as error:
            raise OcrInputError("OCR_TIMEOUT") from error
    if result.returncode != 0:
        raise OcrInputError("OCR_FAILED")
    text = result.stdout.decode("utf-8", errors="replace").replace("\x00", "").strip()
    if not text:
        raise OcrInputError("OCR_TEXT_EMPTY")
    if len(text) > MAX_TEXT_CHARS:
        raise OcrInputError("OCR_TEXT_TOO_LONG")
    return jsonify({"text": text, "charCount": len(text)})


def safe_image(content: bytes) -> Image.Image:
    if not content or len(content) > MAX_BYTES:
        raise OcrInputError("FILE_TOO_LARGE")
    if not (content.startswith(b"\x89PNG\r\n\x1a\n") or content.startswith(b"\xff\xd8\xff")):
        raise OcrInputError("TYPE_UNSUPPORTED")
    try:
        with Image.open(io.BytesIO(content), formats=["PNG", "JPEG"]) as probe:
            probe.verify()
        with Image.open(io.BytesIO(content), formats=["PNG", "JPEG"]) as decoded:
            if getattr(decoded, "n_frames", 1) != 1:
                raise OcrInputError("MULTI_FRAME_UNSUPPORTED")
            decoded.load()
            if decoded.width > MAX_DIMENSION or decoded.height > MAX_DIMENSION:
                raise OcrInputError("IMAGE_DIMENSION_TOO_LARGE")
            if decoded.width * decoded.height > MAX_PIXELS:
                raise OcrInputError("IMAGE_PIXELS_TOO_LARGE")
            return decoded.convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning, OcrInputError):
        raise
    except Exception as error:
        raise OcrInputError("IMAGE_INVALID") from error


@app.errorhandler(OcrInputError)
def input_error(error):
    return jsonify({"code": str(error)}), 422


@app.errorhandler(RequestEntityTooLarge)
def too_large(_error):
    return jsonify({"code": "FILE_TOO_LARGE"}), 413
