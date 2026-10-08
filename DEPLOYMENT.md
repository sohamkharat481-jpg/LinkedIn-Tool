# Render Deployment Guide

This guide details how to deploy the **LinkedIn Lead Finder** full-stack application (Express backend + React Vite frontend) to **Render**.

---

## 1. Prerequisites

1. A [Render](https://render.com/) account connected to your GitHub/GitLab repository.
2. Your existing **Supabase** project URL and anon key.
3. (Optional) Your Google Custom Search API Key and Search Engine ID.

---

## 2. Required Production Environment Variables

Configure these variables securely in your Render Web Service settings (Environment tab):

| Variable Name | Required | Description |
|---|---|---|
| `SUPABASE_URL` | **Yes** | Your Supabase project URL (`https://xyzcompany.supabase.co`) |
| `SUPABASE_ANON_KEY` | **Yes** | Your Supabase anon public key |
| `GOOGLE_SEARCH_API_KEY` | Optional | Google Custom Search JSON API Key |
| `GOOGLE_SEARCH_ENGINE_ID` | Optional | Google Programmable Search Engine ID (cx) |
| `PORT` | Auto | Render automatically assigns and injects `PORT` |
| `NODE_ENV` | Yes | Set to `production` |

---

## 3. Deployment Steps via Render Dashboard

1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository containing the LinkedIn Lead Finder project.
4. Configure the service settings:
   - **Name**: `linkedin-lead-finder-backend`
   - **Environment**: `Node`
   - **Region**: Choose closest to your users (e.g., Oregon or Singapore)
   - **Branch**: `main` (or your deployment branch)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free` (or higher)
5. Under **Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `GOOGLE_SEARCH_API_KEY` (if using search provider)
   - `GOOGLE_SEARCH_ENGINE_ID` (if using search provider)
6. Click **Create Web Service**. Render will automatically build and deploy your application.

---

## 4. Connecting the Frontend (If Hosted on Vercel or Separate Domain)

If your frontend is hosted separately (e.g., Vercel):
1. In your frontend hosting dashboard (Vercel Project Settings > Environment Variables), add:
   - `VITE_API_BASE_URL`: `https://your-render-service-name.onrender.com`
2. CORS headers are pre-configured in `server.ts` to accept cross-origin requests securely.

---

## 5. Verification Endpoints

Once Render successfully deploys your service, test the health and Supabase connection:

```bash
# 1. Service Health Check
curl https://your-render-service-name.onrender.com/api/health

# 2. Supabase Integration Status
curl https://your-render-service-name.onrender.com/api/supabase-status

# 3. Provider Status Diagnostics
curl https://your-render-service-name.onrender.com/api/provider-status
```
