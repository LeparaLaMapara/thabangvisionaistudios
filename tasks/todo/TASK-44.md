Add security hardening for production:

1. HIDE TECH STACK — add to next.config.ts:
   headers: [{
     source: '/(.*)',
     headers: [
       { key: 'X-Powered-By', value: '' },
       { key: 'Server', value: '' },
       { key: 'X-Frame-Options', value: 'DENY' },
       { key: 'X-Content-Type-Options', value: 'nosniff' },
       { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
       { key: 'Permissions-Policy', value: 'camera=self, microphone=(), geolocation=()' },
     ],
   }],

2. DISABLE SOURCE MAPS in production — next.config.ts:
   productionBrowserSourceMaps: false,
   
   This prevents anyone from reading your original source code in browser DevTools.

3. API RATE LIMITING — already have this but verify all public routes are limited:
   /api/ubunye-chat: 10 req/min
   /api/contact: 5 req/min
   /api/bookings: 5 req/min
   /api/crew/request: 5 req/min

4. DISABLE DIRECTORY LISTING — already handled by Next.js

5. CSP HEADER — Content Security Policy:
   Content-Security-Policy: default-src 'self'; 
     script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co; 
     style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
     img-src 'self' https://res.cloudinary.com data: blob:;
     font-src 'self' https://fonts.gstatic.com;
     connect-src 'self' https://*.supabase.co https://api.anthropic.com https://api.paystack.co;
     frame-src https://checkout.paystack.com;
1. Enable DNSSEC in Cloudflare
2. Enable "Under Attack Mode" if you ever get DDoS'd (one click)
3. Hide WHOIS info — Cloudflare does this by default
4. Enable Cloudflare proxy (orange cloud) — hides your real server IP
5. Set SSL to "Full (Strict)" 