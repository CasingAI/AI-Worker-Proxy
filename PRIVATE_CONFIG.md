# Private Configuration Guide

## 🎯 How It Works

- **`ROUTES_CONFIG`** → GitHub Variable → injected into wrangler.toml during deploy
- **Secrets** (PROXY_AUTH_TOKEN, API keys) → Cloudflare Dashboard (manually, persist across deploys)

**Key point:** Cloudflare Secrets are NEVER deleted by wrangler deploy. Set them once in Dashboard, they stay forever.

---

## 📝 Setup Instructions

### Step 1: Add Secrets to Cloudflare Dashboard

1. Go to **Cloudflare Dashboard** → **Workers & Pages** → **ai-worker-proxy** → **Settings** → **Variables**

2. Click **"Add variable"** → Select **"Encrypt"** (this makes it a Secret)

3. Add these secrets:
   - `PROXY_AUTH_TOKEN` = `your-secret-token`
   - `ANTHROPIC_KEY_1` = `sk-ant-xxxxx`
   - `GOOGLE_KEY_1` = `AIzaxxxxx`
   - `OPENAI_KEY_1` = `sk-xxxxx`
   - `NVIDIA_KEY_1` = `nvapi-xxxxx`
   - `GROQ_KEY_1` = `gsk_xxxxx`
   - etc.

4. Click **"Save and Deploy"**

**IMPORTANT:** These secrets will NEVER be deleted or overwritten by GitHub Actions deployments. Set them once and forget.

### Step 2: Add GitHub Variable

1. Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab

2. Click **"New repository variable"**

3. Name: `ROUTES_CONFIG`

4. Value (JSON, can be formatted):
```json
{
  "deep-think": [
    {
      "provider": "anthropic",
      "model": "claude-opus-4-20250514",
      "apiKeys": ["ANTHROPIC_KEY_1", "ANTHROPIC_KEY_2"]
    }
  ],
  "fast": [
    {
      "provider": "google",
      "model": "gemini-2.0-flash-exp",
      "apiKeys": ["GOOGLE_KEY_1"]
    }
  ],
  "nvidia": [
    {
      "provider": "openai-compatible",
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "model": "nvidia/llama-3.1-nemotron-70b-instruct",
      "apiKeys": ["NVIDIA_KEY_1"]
    }
  ]
}
```

### Step 3: Add GitHub Secrets (for Cloudflare auth)

1. Go to **Secrets** tab (next to Variables)

2. Add these:
   - `CLOUDFLARE_API_TOKEN` - Your Cloudflare API token
   - `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

### Step 4: Deploy

```bash
git push origin main
```

GitHub Actions will:
1. Replace `ROUTES_CONFIG` in wrangler.toml with your GitHub Variable
2. Deploy to Cloudflare
3. Your Dashboard secrets remain untouched

---

## 🔄 Updating Configuration

### Update Routes (ROUTES_CONFIG)

1. Edit the variable in GitHub: Settings → Secrets and variables → Actions → **Variables** → ROUTES_CONFIG
2. Push any commit to main (or manually re-run workflow)
3. Done! New routes deployed.

### Update Secrets (API Keys, Auth Token)

1. Go to **Cloudflare Dashboard** → Workers & Pages → ai-worker-proxy → Settings → Variables
2. Edit the encrypted variable
3. Click "Save and Deploy"
4. Done! (No need to push anything)

---

## 🏠 Local Development

Create `.dev.vars` file (DO NOT commit):

```bash
# .dev.vars
PROXY_AUTH_TOKEN=local-dev-token
ANTHROPIC_KEY_1=sk-ant-xxxxx
GOOGLE_KEY_1=AIzaxxxxx

ROUTES_CONFIG={"test":[{"provider":"anthropic","model":"claude-opus-4","apiKeys":["ANTHROPIC_KEY_1"]}]}
```

Run locally:
```bash
npm run dev
```

Wrangler will automatically load variables from `.dev.vars`.

---

## 🆘 Troubleshooting

### GitHub Actions fails with "vars.ROUTES_CONFIG not found"

**Solution:**
1. Make sure you added `ROUTES_CONFIG` as a **Variable** (not Secret)
2. Go to Settings → Secrets and variables → Actions → **Variables** tab
3. Variables and Secrets are in different tabs!

### Worker can't authenticate / missing API keys

**Solution:**
1. Check secrets are set in **Cloudflare Dashboard** (not GitHub)
2. Go to Cloudflare Dashboard → Workers & Pages → ai-worker-proxy → Settings → Variables
3. Make sure secrets are marked as "Encrypted"
4. Click "Save and Deploy" after adding/editing

### ROUTES_CONFIG is not updating after push

**Solution:**
1. Check GitHub Actions logs - did the workflow run?
2. Check if GitHub Variable `ROUTES_CONFIG` is set correctly
3. Make sure the JSON is valid (use a JSON validator)
4. Check the workflow replaced the [vars] section (look at logs)

### Want to add a new API provider

**Solution:**
1. Add the API key to **Cloudflare Dashboard** as encrypted variable (e.g., `DEEPSEEK_KEY_1`)
2. Update GitHub Variable `ROUTES_CONFIG` to include the new route
3. Push to trigger deployment

---

## 📋 Checklist

- [ ] All secrets added to **Cloudflare Dashboard** (encrypted variables)
- [ ] `ROUTES_CONFIG` added as **GitHub Variable**
- [ ] `CLOUDFLARE_API_TOKEN` added as GitHub Secret
- [ ] `CLOUDFLARE_ACCOUNT_ID` added as GitHub Secret
- [ ] `.dev.vars` created for local development (not committed)
- [ ] Pushed to main and verified deployment succeeded

---

## 📖 Why This Works

**The Problem:**
- Wrangler ALWAYS overwrites vars defined in wrangler.toml [vars] section
- But Cloudflare Secrets are NEVER deleted by wrangler deploy

**The Solution:**
- `ROUTES_CONFIG` goes in [vars] → GitHub Actions replaces it before deploy
- Sensitive data (tokens, API keys) goes in Cloudflare Secrets → never touched

**Result:**
- Public repo stays clean (example config only)
- ROUTES_CONFIG easily updated via GitHub Variable
- Secrets stay secure in Cloudflare Dashboard
- No accidental overwrites

---

## 📚 References

- [Cloudflare Secrets Documentation](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub Actions Variables](https://docs.github.com/en/actions/learn-github-actions/variables)
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
