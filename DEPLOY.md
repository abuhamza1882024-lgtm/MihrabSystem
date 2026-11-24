# Deployment

## Supabase

1. Create or select a Supabase project.
2. Link this directory:

   ```powershell
   npx supabase link --project-ref PROJECT_REF
   ```

3. Apply the database migration:

   ```powershell
   npx supabase db push
   ```

4. Deploy the API:

   ```powershell
   npx supabase functions deploy mihrab
   ```

5. Set `public/config.js` to:

   ```javascript
   window.MIHRAB_API='https://PROJECT_REF.supabase.co/functions/v1/mihrab';
   ```

6. Generate a long random `CRON_KEY`, save it as an Edge Function secret, and schedule a POST request to `/functions/v1/mihrab/api/tick` every minute with that value in the `x-cron-key` header.

7. Set the optional WhatsApp secrets listed in `.env.example` to enable automatic delivery.

8. Import the existing `data.json` if needed:

   ```powershell
   $env:MIHRAB_API_URL='https://PROJECT_REF.supabase.co/functions/v1/mihrab'
   $env:MIHRAB_ADMIN_PASSWORD='admin123'
   node scripts/import-data.mjs
   ```

Teacher images are uploaded to the public `teacher-images` bucket. Database tables are protected by Row Level Security and are accessed only through the Edge Function.

## Vercel

Deploy the `public` directory:

```powershell
cd public
npx vercel --prod
```

Change the default admin and HR passwords immediately after the first login.
