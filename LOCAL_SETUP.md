# Run locally

Requires Docker running with Docker Compose installed.

1. From the repository root, open `infra/`. If `.env` does not exist, copy `.env.example` to `.env`.
2. Set these values in `infra/.env` using your Asgardeo application credentials:

   ```dotenv
   CODESAGE_ASGARDEO_BASE_URL=https://api.asgardeo.io/t/YOUR_ORG
   CODESAGE_ASGARDEO_CLIENT_ID=YOUR_CLIENT_ID
   CODESAGE_ASGARDEO_CLIENT_SECRET=YOUR_CLIENT_SECRET
   CODESAGE_RESEND_API_KEY=re_YOUR_API_KEY
   CODESAGE_INVITATION_FROM_EMAIL=CodeSage <onboarding@resend.dev>
   CODESAGE_WEB_API_BASE_URL=http://localhost:8000
   ```

   Configure the Asgardeo application's allowed callback URL as `http://localhost:8000/api/auth/callback`.
   For production email, verify your domain in Resend and change the invitation sender to an address on that domain.

3. Run from `infra/`:

   ```bash
   docker compose up -d --build
   ```

   The first build takes several minutes. Database migrations run automatically.

4. Open **http://localhost:3000**, sign in, and scan a **Java repository**.

Check status and logs from `infra/`:

```bash
docker compose ps -a
docker compose logs --tail=100 migrate api worker score-worker ml
```

The `migrate` container should exit with code `0`; the other services stay running.

Stop without deleting database data:

```bash
docker compose down
```

Do not add `-v` unless you want to delete the stored database.
