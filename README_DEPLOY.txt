WayHaven separated frontend/backend
----------------------------------
Frontend: frontend
Backend: backend

What I changed:
- Split files into frontend/ and backend/ directories (copied detected roots).
- Added a '_redirects' file in frontend to proxy '/api/*' to 'https://REPLACE_WITH_VERCEL_URL/api/:splat' on Netlify.
- Added a simple vercel.json at project root to help deploy the backend to Vercel.
- Replaced some hardcoded 'http://localhost:3000' occurrences in frontend JS with a placeholder 'API_BASE'. You MUST replace 'API_BASE' in the frontend JS or set up a build-time replacement.
- If no backend detected, I created a small placeholder Express server in backend/server.js.

Deployment tips:
- Deploy frontend folder to Netlify (drag & drop or connect repo). In Netlify, set a Redirects file if you want to proxy API requests to your backend on Vercel; edit _redirects in frontend to point to your Vercel URL.
- Deploy backend folder to Vercel (connect repo, ensure vercel.json is present). Vercel will expose endpoints under https://<your-vercel>.vercel.app/api/...
- Update frontend API references to your Vercel domain or configure Netlify redirects to proxy '/api/*' to your Vercel backend domain.

Important files added: netlify.toml, _redirects, vercel.json, README.txt.

Replaced JS files: []

