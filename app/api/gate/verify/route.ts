import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

const CONFIRMED_PAYMENT_STATUSES = ["paid", "verified"];

function todayInSouthAfrica() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function getDateStatus(bookingDate: string | null | undefined, today: string) {
  if (!bookingDate) return "past";
  if (bookingDate === today) return "today";
  return bookingDate > today ? "future" : "past";
}

function extractToken(value: string) {
  if (!value.includes("token=")) return value;
  try {
    return new URL(value, "http://gate.local").searchParams.get("token") ?? "";
  } catch {
    return "";
  }
}

async function verifyToken(rawToken: string) {
  const token = extractToken(rawToken.trim());
  if (!token) return NextResponse.json({ error: "INVALID QR CODE" }, { status: 400 });

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select("id, reservation_code, customer_name, booking_date, booking_time, adults, children_3_plus, children_under_3, selected_area_id, payment_method, total_price, booking_status, payment_status, checked_in, checked_in_at")
      .eq("check_in_token", token)
      .maybeSingle();

  if (error) return NextResponse.json({ error: "Unable to verify QR code." }, { status: 500 });
  if (!booking) return NextResponse.json({ error: "INVALID QR CODE" }, { status: 404 });

  const { data: area } = booking.selected_area_id
    ? await supabaseAdmin.from("products").select("name").eq("id", booking.selected_area_id).maybeSingle()
    : { data: null };

  const today = todayInSouthAfrica();
  const paymentConfirmed = CONFIRMED_PAYMENT_STATUSES.includes(String(booking.payment_status ?? "").toLowerCase());
  const bookingConfirmed = String(booking.booking_status ?? "").toLowerCase() === "confirmed";
  const dateStatus = getDateStatus(booking.booking_date, today);
  const base = {
    booking: { ...booking, area_name: area?.name ?? "No Picnic Area" },
    paymentConfirmed,
    paymentError: paymentConfirmed ? null : "Payment has not been confirmed by Chamlija staff. Entry is not available until payment is approved.",
    bookingConfirmed,
    isToday: booking.booking_date === today,
    dateStatus,
    verificationStatus: !paymentConfirmed ? "PAYMENT NOT CONFIRMED" : !bookingConfirmed ? "BOOKING NOT CONFIRMED" : dateStatus === "today" ? "CHECK-IN APPROVED" : dateStatus === "future" ? "RESERVATION VERIFIED" : "RESERVATION EXPIRED",
    checkInEligible: paymentConfirmed && bookingConfirmed && dateStatus === "today" && !booking.checked_in,
  };

  return NextResponse.json({ success: true, ...base }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    return await verifyToken(new URL(request.url).searchParams.get("token") ?? "");
  } catch {
    return NextResponse.json({ error: "Unable to verify QR code." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawToken = typeof body?.token === "string" ? body.token : "";
    return await verifyToken(rawToken);
  } catch {
    return NextResponse.json({ error: "Unable to verify QR code." }, { status: 500 });
  }
}
