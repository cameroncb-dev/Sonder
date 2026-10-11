# Sonder

Hacklanta 2026 sponsored by Adobe

Collaborative visual workspace for creative projects across multiple applications. See
`Design_Plan.md` for the plan, `docs/setup.md` to get running, and `docs/progress.md` for status.

```sh
pnpm install
pnpm dev                                   # web: http://localhost:3000
cd services/vision && .venv/bin/uvicorn sonder_vision.main:app --app-dir src --port 8000
```
