# Contributing to Smara

Thanks for your interest in contributing to Smara. Here's how to get started.

## Development Setup

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/smara-io/api.git
cd api
npm install
```

2. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

You need:
- A PostgreSQL 15+ database with the `pgvector` extension
- A Voyage AI API key (for embeddings)

3. Run database migrations:

```bash
npm run db:migrate
```

4. Start the dev server:

```bash
npm run dev
```

The API runs on `http://localhost:3010` by default.

## Docker

```bash
VOYAGE_API_KEY=your-key docker compose up -d
```

## Pull Requests

- Fork the repo, create a feature branch, and open a PR against `main`.
- Keep PRs focused. One feature or fix per PR.
- Add a brief description of what changed and why.
- Make sure `npm run build` passes before submitting.

## Code Style

- TypeScript, strict mode.
- Use the existing patterns in `src/routes/` for new endpoints.
- No default exports. Use named exports.

## Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- API response (with any sensitive data redacted)

## Feature Requests

Open an issue describing the use case. We prioritize based on community demand.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
