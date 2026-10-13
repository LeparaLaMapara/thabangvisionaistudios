# TASK-075: Client gallery for delivery
## Priority: MEDIUM | Added by the owner on 2026-10-13
## Files allowed: new app/gallery/*, lib/storage/*, app/dashboard/bookings/*, a new migration

## Why
Delivery today is one pasted link (`bookings.delivery_url`, migration 020).
The client cannot pick, comment or download in one place, and the platform
cannot see that the work was delivered.

## Plan
1. Creator uploads finished work to the booking (Cloudinary today; R2 later
   for big video files).
2. Private gallery link for the client: view, heart favourites, comment on a
   photo or a video time, download all (zip) or single files.
3. Watermarked previews until the booking is fully paid; clean files after.
4. "Delivered" and "client approved" become booking events, which feed the
   48h release and reviews.
5. Later: "request an edit" opens the photo in Ubunye Light (studio-tools),
   and favourites feed the creator's portfolio with the client's consent.

## Watch out
Storage cost: set an expiry (e.g. 90 days) and tell both sides.
