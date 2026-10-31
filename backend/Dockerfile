# FairSprint AI backend (FastAPI). Build context: ./backend
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first so this layer is cached until requirements.txt changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Application code and SQL migrations. Secrets are NOT baked in: .env is provided at runtime.
COPY app ./app
COPY migrations ./migrations

# Run as an unprivileged user.
RUN useradd --create-home --uid 10001 appuser
USER appuser

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request as u; u.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8000'), timeout=4)"

# Shell form so $PORT is expanded (hosts such as Render inject their own PORT).
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
