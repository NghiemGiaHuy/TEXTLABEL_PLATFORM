# Text Labeling Platform

Full-stack text annotation platform for dataset import, labeling, review, task assignment, notification, and export workflows.

## Structure

- `text-labeling-api`: FastAPI backend, PostgreSQL, SQLAlchemy, Alembic.
- `text-labeling-frontend`: React + TypeScript + Vite frontend.
- `data.sql`: database seed/export script.

## Run Backend

```bash
cd text-labeling-api
docker compose up -d --build
```

Backend health check:

```bash
curl http://localhost:8000/health
```

## Run Frontend

```bash
cd text-labeling-frontend
npm install
npm run dev
```

Default frontend URL: `http://localhost:5173`.

## Quality Checks

Frontend:

```bash
cd text-labeling-frontend
npm run lint
npm run build
```

Backend, inside the running API container:

```bash
docker exec tlp_api ruff check app alembic
docker exec tlp_api python -m compileall app
```
