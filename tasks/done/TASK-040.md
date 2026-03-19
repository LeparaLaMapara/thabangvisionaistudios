Add bug reporting through Ubunye chat. When a user reports a bug, Ubunye structures it and saves to a report_bugs table.

1. DATABASE — create migration lib/migrations/008-bug-reports.sql:

   create table if not exists bug_reports (
     id uuid primary key default gen_random_uuid(),
     user_id uuid references auth.users(id),
     user_email text,
     title text not null,
     description text not null,
     steps_to_reproduce text,
     expected_behaviour text,
     actual_behaviour text,
     page_url text,
     screenshot_urls text[] default '{}',
     device_info text,
     browser_info text,
     severity text default 'medium' 
       check (severity in ('low', 'medium', 'high', 'critical')),
     status text default 'open'
       check (status in ('open', 'in_progress', 'resolved', 'wont_fix', 'duplicate')),
     admin_notes text,
     created_at timestamptz default now(),
     updated_at timestamptz default now()
   );

   alter table bug_reports enable row level security;

   create policy "Users can insert bug reports" on bug_reports
     for insert with check (true);

   create policy "Users can view own reports" on bug_reports
     for select using (auth.uid() = user_id);

   create policy "Admins can manage all reports" on bug_reports
     for all using (true);

2. BUG REPORT PAGE — create app/(platform)/support/report-bug/page.tsx:

   Two options on the page:

   OPTION A: Chat with Ubunye (recommended)
   "Describe the issue to Ubunye and it will create a structured 
    bug report for you. You can paste screenshots too."
   [Opens Ubunye chat with pre-loaded prompt]
   
   OPTION B: Manual form
   - Title (required)
   - Description (required)
   - Screenshot upload (optional, up to 3 images)
   - Page where bug occurred (optional)
   - Severity: Low / Medium / High / Critical
   - [SUBMIT BUG REPORT]

3. UBUNYE BUG REPORT TOOL — add to Ubunye's tools (for V4 function calling) or handle in system prompt for now:

   Add to system prompt:
   "When a user reports a bug, issue, or problem with the platform:
   1. Acknowledge the issue
   2. Ask clarifying questions if needed:
      - What page were you on?
      - What did you expect to happen?
      - What actually happened?
      - Can you share a screenshot?
   3. Once you have enough info, summarize the bug report:
   
   BUG REPORT SUMMARY:
   Title: [short description]
   Page: [URL or page name]
   Expected: [what should happen]
   Actual: [what actually happened]
   Severity: [low/medium/high/critical]
   
   4. Ask: 'Should I submit this report? Our team will look into it.'
   5. If user confirms, POST to /api/bug-reports with the structured data"

4. API ROUTE — create app/api/bug-reports/route.ts:

   POST — create bug report:
   - Accept: { title, description, steps_to_reproduce, expected_behaviour,
               actual_behaviour, page_url, screenshot_urls, severity }
   - Auto-capture: user_id (if logged in), user_email, device_info from user-agent
   - Rate limit: 5 reports per hour per user/IP
   - Return success message
   - Send admin notification email: "New bug report: [title]"

   GET — list own bug reports (authenticated):
   - Returns user's submitted reports with status

5. SCREENSHOT UPLOAD:
   - Upload to Supabase Storage bucket "bug-screenshots"
   - Path: bug-screenshots/{report_id}/{filename}
   - Max 3 screenshots per report
   - Max 5MB each
   - Create the storage bucket:
     insert into storage.buckets (id, name, public) 
     values ('bug-screenshots', 'bug-screenshots', false);

6. ADMIN BUG REPORTS PAGE — create app/(admin)/admin/bug-reports/page.tsx:

   Tabs: [Open X] [In Progress] [Resolved] [All]

   Each report shows:
   - Title and severity badge
   - Description
   - Screenshots (if any)
   - User info (name, email)
   - Device and browser info
   - Page URL
   - Submitted date
   - Status dropdown: Open → In Progress → Resolved / Won't Fix / Duplicate
   - Admin notes textarea
   
   Admin dashboard home should show: "X open bug reports" count

7. USER BUG REPORT STATUS — add to dashboard:

   /dashboard/my-reports (or section on dashboard home):
   - Shows list of user's submitted reports
   - Each shows: title, status badge, submitted date
   - Status: Open (yellow), In Progress (blue), Resolved (green)
   - User can see status but cannot edit after submission

8. NAVIGATION:
   - Add "Report a Bug" link in footer
   - Add "Report a Bug" link in /support/tech page
   - Add to Ubunye quick action chips: "Report a problem"