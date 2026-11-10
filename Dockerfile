FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    KOITO_DB=/koito/koito.db \
    STATS_DB=/data/stats.db \
    BASE_PATH=/stats

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY koito_stats ./koito_stats
COPY static ./static

RUN useradd --uid 1000 --create-home stats && mkdir -p /data && chown stats /data
USER stats

EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:8000'+os.environ['BASE_PATH']+'/api/health', timeout=4)"
CMD ["python", "-m", "koito_stats", "serve", "--port", "8000"]
