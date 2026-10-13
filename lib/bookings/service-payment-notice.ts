/**
 * The message a customer sees on /dashboard/bookings after paying (or not)
 * for a service booking. `status` is what /api/service-bookings/callback
 * found when it asked Paystack; "cancelled" is Paystack's cancel link.
 */
export type ServicePaymentNoticeView = { tone: 'good' | 'bad' | 'wait'; title: string; body: string };

const SAFE_REF = /^[A-Za-z0-9.=-]{1,100}$/;

export function servicePaymentNotice(status: string | null, ref: string | null): ServicePaymentNoticeView | null {
  const booking = ref && SAFE_REF.test(ref) ? `booking ${ref}` : 'your booking';
  switch (status) {
    case 'success':
      return { tone: 'good', title: 'Payment received', body: `Thank you. ${capital(booking)} is paid and your creator has been told.` };
    case 'held':
      return { tone: 'wait', title: 'Payment received, being checked', body: `We received your payment for ${booking}, but a person on our team must check it before the booking is confirmed. We will contact you. Please do not pay again.` };
    case 'failed':
      return { tone: 'bad', title: 'Payment did not go through', body: `Your payment for ${booking} was not successful and nothing was taken. Your booking is saved: use the Pay again button to try another card.` };
    case 'pending':
      return { tone: 'wait', title: 'Payment still processing', body: `Paystack is still processing your payment for ${booking}. It shows as paid here once they confirm. Please do not pay again yet.` };
    case 'cancelled':
      return { tone: 'wait', title: 'Payment not finished', body: 'You left the payment page before paying, so nothing was taken. Your booking is saved: use the Pay again button when you are ready.' };
    case 'error':
      return { tone: 'bad', title: 'We could not check your payment', body: `We could not confirm the payment for ${booking} just now. If money left your account, do not pay again: the booking updates as soon as Paystack tells us, or contact us and we will check.` };
    default:
      return null;
  }
}

/** Whether a service booking can be paid (again) online from the bookings list. */
export function canPayAgain(b: { status: string; payment_status: string }, paymentsOpen: boolean | null): boolean {
  return paymentsOpen === true && b.status === 'pending' && b.payment_status === 'unpaid';
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
