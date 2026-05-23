# React + Express Migration

## Backend

1. Copy `backend/.env.example` to `backend/.env`
2. Set:
   - `HF_TOKEN`
   - `JWT_SECRET`
3. Install:
   - `npm.cmd install --prefix backend`
4. Run:
   - `npm.cmd run dev:backend`

## Frontend

1. Copy `frontend/.env.example` to `frontend/.env` if needed
2. Install:
   - `npm.cmd install --prefix frontend`
3. Run:
   - `npm.cmd run dev:frontend`

## Auth

- Register creates a local file-based user in `backend/data/users.json`
- Login returns a JWT
- Frontend stores the token in `localStorage`
- Logout removes the token client-side

## Current State

- `frontend/` is the new React UI
- `backend/` is the new Express API
- The old Streamlit/Python files are still present as legacy code and can be removed after you verify the new stack
