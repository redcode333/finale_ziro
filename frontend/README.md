# FairSprint AI frontend

React + Vite + TypeScript, Tailwind, shadcn/ui, TanStack Query, React Router, MSW.

    npm install
    cp .env.example .env.local   # VITE_USE_MOCKS=true uses MSW + the synthetic dataset
    npm run dev

To use the real FastAPI backend: set `VITE_USE_MOCKS=false` and `VITE_API_BASE_URL` to the API URL.
Contract: `../docs/API_CONTRACT.md`.
Simulate a failed execution in mock mode: `localStorage.setItem('mock.failExecution', '1')`.
