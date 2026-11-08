# syntax=docker/dockerfile:1.7
# Full-stack NetScope image: static frontend + inspector API.
# Build from the repository root:
#   docker build -f pyapp/Dockerfile -t netscope .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STATIC_DIR=/app \
    PORT=8080

WORKDIR /app

RUN groupadd --system netscope && useradd --system --gid netscope --home /app netscope

COPY pyapp/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY pyapp ./pyapp
COPY index.html site.webmanifest robots.txt ./
COPY assets ./assets

RUN chown -R netscope:netscope /app
USER netscope

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3).status == 200 else 1)"

CMD ["gunicorn", "--chdir", "pyapp", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "--timeout", "60", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
