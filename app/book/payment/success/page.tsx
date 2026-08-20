import Link from "next/link";
import { Suspense } from "react";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

async function PaymentSuccessContent({ bookingId }: { bookingId: string }) {
  const supabaseAdmin = getSupabaseAdminClient();

  const booking = bookingId
    ? (
        await supabaseAdmin
          .from("bookings")
          .select("id, reservation_code, customer_name, email, phone_number, booking_status, payment_status, total_price")
          .eq("id", bookingId)
          .maybeSingle()
      )?.data ?? null
    : null;

  const total = Number(booking?.total_price ?? 0);
  const reservationCode = booking?.reservation_code || booking?.id || "—";

  return (
    <main className="booking-ui min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-emerald-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.04)] sm:p-8">
        <div className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Payment successful</div>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">Your reservation is confirmed</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Thank you for booking with Buyuk Chamlija. Your payment has been received and your reservation is now confirmed.
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reservation code</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-slate-900">{reservationCode}</div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Customer</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">{booking?.customer_name || "Guest"}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total paid</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">
              {new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(total)}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Need help or an issue arises?</div>
          <div className="mt-2">Please contact us at +27 65 585 9178 or email buyukchamlija@uict.org.za with your reservation code.</div>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/" className="inline-flex items-center justify-center rounded-full bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(4,120,87,0.18)] transition hover:bg-emerald-800">
            Back to home
          </Link>
          <Link href="/book" className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
            Make another booking
          </Link>
        </div>
      </div>
    </main>
  );
}

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ bookingId?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const bookingId = typeof params.bookingId === "string" ? params.bookingId : "";

  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">Loading confirmation...</div>}>
      <PaymentSuccessContent bookingId={bookingId} />
    </Suspense>
  );
}
