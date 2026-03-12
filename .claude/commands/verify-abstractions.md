Verify all provider abstraction layers are properly used across the codebase:

1. AI Provider — should only be imported in lib/ai/:
   - grep -rn "from '@anthropic-ai" --include="*.ts" --include="*.tsx"
   - grep -rn "from '@google/generative-ai'" --include="*.ts" --include="*.tsx"
   - grep -rn "from 'openai'" --include="*.ts" --include="*.tsx"
   - ALLOWED in: lib/ai/anthropic.ts, lib/ai/gemini.ts, lib/ai/openai.ts
   - VIOLATION if found in: app/, components/, pages/

2. Payment Provider — should only be imported in lib/payments/:
   - grep -rn "payfast\|PayFast" --include="*.ts" --include="*.tsx" app/ components/
   - ALLOWED in: lib/payments/payfast.ts
   - VIOLATION if found in: app/api/ routes directly importing payfast

3. Storage Provider — should only be imported in lib/storage/:
   - grep -rn "cloudinary\|Cloudinary" --include="*.ts" --include="*.tsx" app/ components/
   - ALLOWED in: lib/storage/cloudinary.ts
   - VIOLATION if found in: app/api/ routes directly importing cloudinary

4. Email Provider — should only be imported in lib/email/:
   - grep -rn "nodemailer\|Nodemailer" --include="*.ts" --include="*.tsx" app/ components/
   - ALLOWED in: lib/email/gmail.ts
   - VIOLATION if found in: app/api/ routes directly importing nodemailer

5. Constants Usage — business values should come from constants:
   - grep -rn "depositPercent\|rental.deposit" --include="*.ts" --include="*.tsx"
   - Verify they reference STUDIO.rental.depositPercent, not hardcoded numbers

6. Report:
   ✅ ALL ABSTRACTIONS CLEAN — no violations
   OR
   ❌ VIOLATIONS FOUND — list each with file path and line number
