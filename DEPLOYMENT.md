# Vercel Deployment Guide

This guide details how to deploy the **LinkedIn Lead Finder** full-stack application (Express backend serverless functions + React Vite frontend) to **Vercel** with zero billing required.

---

## 1. Prerequisites

1. A free [Vercel](https://vercel.com/) account.
2. The GitHub repository containing this codebase.
3. Your Supabase project URL and Anon Key.
4. Your LeadOcean API Key for real B2B people search.

---

## 2. Project Structure for Vercel

- **Frontend**: React + TypeScript + Vite built into `/dist`.
- **Backend**: `api/index.ts` is the single Vercel serverless function entry point and invokes the Express app from `src/server/lambda.ts`.
- **Routing**: `vercel.json` rewrites `/api` and `/api/*` to that function while preserving the original API path for Express. The function restores the path before Express routing; the SPA fallback excludes API paths and sends other client-side routes to the built `index.html`.

---

## 3. Step-by-Step Deployment Instructions

1. **Push your code to GitHub**:
   Ensure your latest repository commit includes `vercel.json`, `api/index.ts`, and `src/server/lambda.ts`. Vercel builds the function from this tracked entry point; Vite builds the frontend into `dist/`.

2. **Import Project into Vercel**:
   - Go to the [Vercel Dashboard](https://vercel.com/dashboard).
   - Click **Add New...** -> **Project**.
   - Import your GitHub repository.

3. **Configure Build Settings**:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`

4. **Configure Environment Variables**:
   In the Vercel project settings under **Environment Variables** (Select Target: **Production**):
   - `SUPABASE_URL`: `https://your-project.supabase.co`
   - `SUPABASE_ANON_KEY`: `your-supabase-anon-key`
   - `GOOGLE_MAPS_API_KEY`: `your-google-maps-api-key` (Primary Google Maps Places provider - server-side only)
   - `SERPER_API_KEY`: `your-serper-api-key` (Optional fallback provider - server-side only)
   - `LEADOCEAN_API_KEY`: `your-leadocean-api-key` (Optional fallback provider - server-side only)
   - `VITE_SUPABASE_URL`: `https://your-project.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `your-supabase-anon-key`

5. **Deploy**:
   - Click **Deploy**. Vercel will build the frontend assets and deploy the serverless backend functions automatically.

---

## 4. Verification

Once deployed, verify your production deployment at your assigned Vercel domain (`https://your-project.vercel.app`):
- `GET /api/health` -> Returns service status (`ok`).
- `GET /api/supabase-status` -> Verifies Supabase connection, database query, and RLS persistence.
- `GET /api/provider-status?type=google_search` -> Reports the configured real provider without exposing its key.
- `POST /api/provider-status/test` -> Executes a live test against the server-configured provider.
