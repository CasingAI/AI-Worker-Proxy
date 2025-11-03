# Private Configuration Guide

## 🎯 How It Works

- **`ROUTES_CONFIG`** → GitHub Variable (not secret) → deployed as Cloudflare env var
- **`PROXY_AUTH_TOKEN`** + API keys → GitHub Secrets → deployed as Cloudflare secrets

This setup ensures:
- ✅ `ROUTES_CONFIG` can be easily updated without re-entering secrets
- ✅ Sensitive tokens remain encrypted as secrets
- ✅ No config in wrangler.toml (stays public-safe)

---

## 📝 Setup Instructions

### Step 1: Add GitHub Variable

1. Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab
2. Click **"New repository variable"**
3. Name: `ROUTES_CONFIG`
4. Value (JSON, can be multiline):
```json
{
  "deep-think": [
    {
      "provider": "anthropic",
      "model": "claude-opus-4-20250514",
      "apiKeys": ["ANTHROPIC_KEY_1"]
    }
  ],
  "fast": [
    {
      "provider": "google",
      "model": "gemini-2.0-flash-exp",
      "apiKeys": ["GOOGLE_KEY_1"]
    }
  ]
}
```

### Step 2: Add GitHub Secrets

1. Go to **Secrets** tab (next to Variables)
2. Click **"New repository secret"**
3. Add these secrets:

**Required:**
- `CLOUDFLARE_API_TOKEN` - Your Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID
- `PROXY_AUTH_TOKEN` - Your proxy authentication token

**API Keys (as needed):**
- `ANTHROPIC_KEY_1` = `sk-ant-xxxxx`
- `GOOGLE_KEY_1` = `AIzaxxxxx`
- `OPENAI_KEY_1` = `sk-xxxxx`
- `NVIDIA_KEY_1` = `nvapi-xxxxx`
- `GROQ_KEY_1` = `gsk_xxxxx`

### Step 3: Push to Main

```bash
git push origin main
```

GitHub Actions will:
1. Add `ROUTES_CONFIG` to wrangler.toml temporarily
2. Deploy code + ROUTES_CONFIG as env var
3. Set secrets using `wrangler secret put`

---

## 🔄 Updating Configuration

### Update Routes (ROUTES_CONFIG)

1. Edit the variable in GitHub: Settings → Secrets and variables → Actions → Variables → ROUTES_CONFIG
2. Push any commit to main (or re-run the workflow)
3. Done! New routes deployed.

### Update Secrets (API Keys, Auth Token)

1. Edit the secret in GitHub: Settings → Secrets and variables → Actions → Secrets
2. Push any commit to main (or re-run the workflow)
3. Done! Secrets updated.

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

---

## 🆘 Troubleshooting

### GitHub Actions fails with "vars.ROUTES_CONFIG not found"

**Solution:**
1. Make sure you added ROUTES_CONFIG as a **Variable** (not Secret)
2. Go to Settings → Secrets and variables → Actions → **Variables** tab
3. Variables and Secrets are different tabs!

### Worker returns "Invalid ROUTES_CONFIG"

**Solution:**
1. Check ROUTES_CONFIG is valid JSON
2. Make sure all API keys referenced in ROUTES_CONFIG are added as Secrets
3. Check GitHub Actions logs to see what was deployed

### Want to add a new API provider

**Solution:**
1. Add the API key to GitHub Secrets (e.g., `DEEPSEEK_KEY_1`)
2. Update `.github/workflows/deploy.yml` to include it in `secrets:` list and `env:` section
3. Update `ROUTES_CONFIG` variable with the new route
4. Push to deploy

---

## 📋 Checklist

- [ ] `ROUTES_CONFIG` added as GitHub **Variable** (not Secret)
- [ ] `CLOUDFLARE_API_TOKEN` added as GitHub Secret
- [ ] `CLOUDFLARE_ACCOUNT_ID` added as GitHub Secret
- [ ] `PROXY_AUTH_TOKEN` added as GitHub Secret
- [ ] All API keys added as GitHub Secrets
- [ ] `.dev.vars` created for local development (not committed)
- [ ] Pushed to main and verified deployment succeeded

---

## 📖 Why This Works

**Before deployment**, GitHub Actions injects ROUTES_CONFIG into wrangler.toml:
```toml
[vars]
ROUTES_CONFIG = '''{ your routes }'''
```

This file is only used during deployment and never committed to git.

**Secrets** are uploaded using `wrangler secret put`, which:
- Encrypts them in Cloudflare
- Persists them across deployments
- Never gets overwritten

**Result:** Clean separation between public code and private config.

## 📚 References

- [GitHub Actions Variables](https://docs.github.com/en/actions/learn-github-actions/variables)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Cloudflare Secrets](https://developers.cloudflare.com/workers/wrangler/commands/#secret)
