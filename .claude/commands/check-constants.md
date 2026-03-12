Check that no business values are hardcoded outside of constants.ts:

1. Phone numbers:
   - grep -rn "079 539\|079539\|0795399012" --include="*.ts" --include="*.tsx"
   - Should ONLY appear in lib/constants.ts
   - Flag any other file

2. Email addresses:
   - grep -rn "thabangvisionstudios@\|thabangvisionstudio@" --include="*.ts" --include="*.tsx"
   - Should ONLY appear in lib/constants.ts and .env files
   - Flag any other file

3. Pricing:
   - grep -rn "1.500\|1,500\|2.850\|2,850\|650/h\|R1500\|R2850\|R650" --include="*.ts" --include="*.tsx"
   - Should ONLY appear in lib/constants.ts (PRODUCTION_SERVICES)
   - Flag any other file (except test files)

4. URLs:
   - grep -rn "thabangvision.io\|thabangvisionlabs.com\|thabangvisionstudios.com" --include="*.ts" --include="*.tsx"
   - Should ONLY appear in lib/constants.ts (STUDIO.meta.url)
   - Flag any other file

5. Social media:
   - grep -rn "instagram.com/thabang\|@thabangvision" --include="*.ts" --include="*.tsx"
   - Should ONLY appear in lib/constants.ts (STUDIO.social)
   - Flag any other file

6. Business terms:
   - grep -rn "50% deposit\|50% Deposit\|2.5x\|24 hours notice\|14 days\|14 Days" --include="*.ts" --include="*.tsx"
   - Should reference STUDIO.rental constants, not hardcoded text
   - Flag any file that hardcodes these terms

7. VAT:
   - grep -rn "15%\|VAT.*15\|0.15" --include="*.ts" --include="*.tsx"
   - Should reference PRODUCTION_SERVICES.billing.vatRate
   - Flag any hardcoded VAT calculation

8. Report:
   ✅ ALL CONSTANTS CLEAN — no hardcoded business values
   OR
   ❌ HARDCODED VALUES FOUND — list each with file, line, and what constant it should reference
