# Client-Specific Instagram OAuth Setup & Integration Guide

This guide describes how to configure, test, and deploy client-specific Instagram OAuth integration for the LinkedIn Lead Finder application.

## 1. Meta Developer App Setup

1. Go to the [Meta for Developers Dashboard](https://developers.facebook.com/).
2. Create or select a Meta App with the **Business** or **Consumer** app type.
3. Add the **Facebook Login** product to your app.
4. Add **Instagram Graph API** capabilities to your app.
5. In Facebook Login Settings, configure valid OAuth Redirect URIs:
   - Development URL: `https://<your-ais-dev-url>.run.app/api/auth/instagram/callback`
   - Production URL: `https://linked-in-tool-beta.vercel.app/api/auth/instagram/callback`

## 2. Required Server-Side Environment Variables

Configure the following environment variables in your server / Vercel deployment:

- `META_APP_ID`: Your Meta App ID from the Meta Developer Dashboard.
- `META_APP_SECRET`: Your Meta App Secret (kept strictly server-side).
- `INSTAGRAM_TOKEN_ENCRYPTION_KEY`: A secure 32-byte (256-bit) secret key used for AES-256-GCM authenticated encryption of client Instagram access tokens.
- `SUPABASE_URL` & `SUPABASE_ANON_KEY`: Supabase database connection credentials.

*(Note: Never prefix server secrets with `VITE_` and never expose app secrets or plaintext tokens to browser code.)*

## 3. Database Migration

Run the migration in `/supabase_migrations/20261016_add_instagram_integrations.sql` against your Supabase database.
This creates the `instagram_integrations` table with:
- `workspace_id` and `client_id` foreign keys with `ON DELETE CASCADE`.
- Unique constraint `UNIQUE(workspace_id, client_id)` ensuring one active integration per client per workspace.
- Row Level Security (RLS) enforcing workspace isolation.

## 4. Client Connection Workflow

1. Navigate to **Settings** in the application.
2. Select the client you wish to connect.
3. Click **Connect Instagram Account**.
4. A popup window opens the Meta authorization dialog requesting required permissions (`instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`).
5. Once authorized, Meta redirects to the server callback, which securely exchanges the code for a token, encrypts it via AES-256-GCM, and persists it in Supabase.
6. The popup automatically closes and notifies the main window, updating the connection status to **Connected**.

## 5. Security & Token Lifecycle

- **Encryption**: Tokens are encrypted before database persistence using AES-256-GCM.
- **Tenant Isolation**: Protected by database RLS policies matching `workspace_id`.
- **Disconnection**: Clients can disconnect at any time, instantly revoking and deleting stored encrypted credentials from the database.
