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
- **Backend**: `api/index.ts` is the single Vercel serverless function entry point. The production build bundles `src/server/lambda.ts` and its local TypeScript imports into `server-build/lambda.js`; Vercel traces that generated module into the function.
- **Routing**: `vercel.json` rewrites `/api` and `/api/*` to that function while preserving the original API path for Express. The function restores the path before Express routing; the SPA fallback excludes API paths and sends other client-side routes to the built `index.html`.

---

## 3. Step-by-Step Deployment Instructions

1. **Push your code to GitHub**:
   Ensure your latest repository commit includes `vercel.json`, `api/index.ts`, `src/server/lambda.ts`, and `package-lock.json`. `npm ci` installs the locked dependencies; the build creates the API bundle and Vite builds the frontend into `dist/`.

2. **Import Project into Vercel**:
   - Go to the [Vercel Dashboard](https://vercel.com/dashboard).
   - Click **Add New...** -> **Project**.
   - Import your GitHub repository.

3. **Configure Build Settings**:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm ci --include=dev` (also set in `vercel.json` so Vite, TypeScript, and esbuild are available during build; `package-lock.json` is authoritative)

4. **Configure Environment Variables**:
   In the Vercel project settings under **Environment Variables** (Select Target: **Production**):
   - `SUPABASE_URL`: `https://your-project.supabase.co`
   - `SUPABASE_ANON_KEY`: `your-supabase-anon-key`
   - `SERPER_API_KEY`: `your-serper-api-key` (Serper.dev search provider - server-side only)
   - `LEADOCEAN_API_KEY`: `your-leadocean-api-key` (LeadOcean people search provider - server-side only)
   - `INSTAGRAM_ACCESS_TOKEN`: Meta user access token for the app user's Instagram professional account (server-side only)
   - `INSTAGRAM_USER_ID`: ID of that Instagram professional account
   - `INSTAGRAM_GRAPH_API_VERSION`: optional Graph API version; defaults to `v25.0`
   - `VITE_SUPABASE_URL`: `https://your-project.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `your-supabase-anon-key`

5. **Deploy**:
   - Click **Deploy**. Vercel will build the frontend assets and deploy the serverless backend functions automatically.

---

## 4. Configure a lead provider

Select **Serper.dev**, **LeadOcean**, or **Instagram Business Discovery (Meta)** in **Settings → Lead Discovery Data Provider**. Configure the selected provider's server-side credentials in the Vercel project environment. Provider selection is explicit; the application does not automatically switch to another provider when the selected provider is unavailable.

Instagram Business Discovery requires a Meta app configured for the Instagram API with Facebook Login, an Instagram Business or Creator account connected to a Facebook Page, a user access token, and the Instagram professional account ID. The token needs `instagram_basic`, `instagram_manage_insights`, and `pages_read_engagement`; if the user's Page role was granted through Business Manager, Meta may additionally require `ads_management` or `ads_read`. Use the app's required access level/review for the intended users. Keep all Meta credentials server-side.

This API only looks up public Business or Creator account usernames explicitly supplied in Lead Finder. It cannot discover arbitrary Instagram accounts by niche or location. Those filters are not used to search Instagram, and the application does not infer locations or contact details. A successful live lookup has not been verified until valid authorized Meta credentials are configured and a request succeeds.

---

## 5. Verification

Once deployed, verify your production deployment at your assigned Vercel domain (`https://your-project.vercel.app`):
- `GET /api/health` -> Returns service status (`ok`).
- `GET /api/supabase-status` -> Verifies Supabase connection, database query, and RLS persistence.
- `GET /api/provider-status?type=serper` -> Reports the selected provider configuration without exposing its key.
- `POST /api/provider-status/test` -> Executes a live test against the server-configured provider.
