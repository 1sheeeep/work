FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp

WORKDIR /app
COPY requirements.txt .
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt \
    && useradd --system --no-create-home ocr

COPY app.py .
USER ocr
EXPOSE 8090
CMD ["gunicorn", "--bind", "0.0.0.0:8090", "--workers", "1", "--threads", "1", "--timeout", "35", "app:app"]
