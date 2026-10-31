# FairSprint AI frontend: build with Node, serve the static files with nginx.
# Build context is the REPO ROOT (the mock layer imports data/synthetic_dataset/dataset.json from outside frontend/):
#   docker build -f frontend/Dockerfile -t fairsprint-frontend .

# ---- build ----
FROM node:24-slim AS build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# Lands at /app/data/..., which is where ../../../data resolves from /app/frontend/src/mocks.
COPY data/synthetic_dataset/dataset.json /app/data/synthetic_dataset/dataset.json

# Vite inlines VITE_* values at build time, so they are build args. They are public: never put secrets here.
ARG VITE_USE_MOCKS=true
ARG VITE_LIVE_API_URL=http://localhost:8000
ARG VITE_LIVE_TEAM_ID=team_fs_001
ARG VITE_LIVE_PROJECT_ID=proj_fs_001
ENV VITE_USE_MOCKS=$VITE_USE_MOCKS \
    VITE_LIVE_API_URL=$VITE_LIVE_API_URL \
    VITE_LIVE_TEAM_ID=$VITE_LIVE_TEAM_ID \
    VITE_LIVE_PROJECT_ID=$VITE_LIVE_PROJECT_ID

RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
