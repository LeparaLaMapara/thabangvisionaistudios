Verify all provider abstraction layers are properly used across the codebase:

1. AI Provider — uses Vercel AI SDK (@ai-sdk/*), thin wrapper in lib/ai/index.ts:
   - grep -rn "from '@ai-sdk/anthropic'" --include="*.ts" --include="*.tsx"
   - grep -rn "from '@ai-sdk/google'" --include="*.ts" --include="*.tsx"
   - grep -rn "from '@ai-sdk/openai'" --include="*.ts" --include="*.tsx"
   - ALLOWED in: lib/ai/index.ts
   - ALLOWED for RAG embeddings: lib/rag/embeddings/gemini.ts, lib/rag/embeddings/openai.ts (use native SDKs)
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
