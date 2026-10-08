# Vercel Deployment Guide

This guide details how to deploy the **LinkedIn Lead Finder** full-stack application (Express backend serverless functions + React Vite frontend) to **Vercel** with zero billing required.

---

## 1. Prerequisites

1. A free [Vercel](https://vercel.com/) account.
2. The GitHub repository containing this codebase.
3. Your Supabase project URL and Anon Key.
4. (Optional) Google Custom Search API Key and Programmable Search Engine ID.

---

## 2. Project Structure for Vercel

- **Frontend**: React + TypeScript + Vite built into `/dist`.
- **Backend**: Express API handler bridged via `api/index.ts` targeting Vercel Serverless Functions.
- **Routing**: Configured via `vercel.json` routing all `/api/*` requests to the Express serverless bridge and client-side routing to `index.html`.

---

## 3. Step-by-Step Deployment Instructions

1. **Push your code to GitHub**:
   Ensure your latest repository commit includes `vercel.json`, `api/index.ts`, and `server.ts`.

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
   In the Vercel project settings under **Environment Variables**, add the following production keys:
   - `SUPABASE_URL`: `https://your-project.supabase.co`
   - `SUPABASE_ANON_KEY`: `your-supabase-anon-key`
   - `GOOGLE_SEARCH_API_KEY`: `your-google-search-api-key` (optional)
   - `GOOGLE_SEARCH_ENGINE_ID`: `your-search-engine-cx-id` (optional)

5. **Deploy**:
   - Click **Deploy**. Vercel will build the frontend assets and deploy the serverless backend functions automatically.

---

## 4. Verification

Once deployed, verify your production deployment at your assigned Vercel domain (`https://your-project.vercel.app`):
- `GET /api/health` -> Returns service status (`ok`).
- `GET /api/supabase-status` -> Verifies Supabase connection, database query, and RLS persistence.
- `GET /api/provider-status` -> Reports lead provider readiness.
