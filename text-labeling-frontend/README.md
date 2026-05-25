# Text Labeling Platform Frontend

React + TypeScript + Vite client for the Text Labeling Platform.

## Main Features

- Role-based workspace for admin, project owner, reviewer, and annotator.
- Project, member, dataset, label set, task assignment, review, notification, and export screens.
- Text classification, sequence labeling, and relation extraction workflows.
- API token refresh, protected routes, toast notifications, and responsive dashboard UI.

## Development

```bash
npm install
npm run dev
```

The local API URL is configured through `.env.local`:

```env
VITE_API_URL=http://localhost:8000
```

## Quality Checks

```bash
npm run lint
npm run build
```

## Deployment

The app is configured for Vercel via `vercel.json`. For production, set:

```env
VITE_API_URL=https://your-api-domain.example
```
