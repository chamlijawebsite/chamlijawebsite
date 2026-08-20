import { redirect } from "next/navigation";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdminAccess } from "@/lib/auth/admin";
import { getDiscountInfo } from "@/lib/business-rules/discounts";
import { ReservationCalendar } from "@/components/admin/reservation-calendar";
import { AdminNotifications, type AdminNotification } from "@/components/admin/admin-notifications";

function formatStatus(status: string | null | undefined) {
  return (status ?? "pending").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatMoney(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  return `R ${safeValue.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizePaymentMethod(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function formatPaymentMethod(value: string | null | undefined) {
  const normalized = normalizePaymentMethod(value);
  if (!normalized) {
    return "Not selected";
  }

  if (normalized.includes("ikhokha")) {
    return "iKhokha";
  }

  if (normalized.includes("bank")) {
    return "Bank Transfer";
  }

  if (normalized.includes("manual") || normalized.includes("cash") || normalized.includes("gate")) {
    if (normalized.includes("cash") || normalized.includes("gate")) {
      return "Cash at Gate";
    }
    return "Manual Payment";
  }

  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatGuestCount(booking: { adults?: number | null; children_3_plus?: number | null; children_under_3?: number | null }) {
  const adults = Number(booking.adults ?? 0);
  const children3Plus = Number(booking.children_3_plus ?? 0);
  const childrenUnder3 = Number(booking.children_under_3 ?? 0);
  const total = adults + children3Plus + childrenUnder3;

  return `${total} guest${total === 1 ? "" : "s"}`;
}

function getVisitorCounts(booking: { adults?: number | null; children_3_plus?: number | null; children_under_3?: number | null }) {
  const adults = Number(booking.adults ?? 0);
  const children = Number(booking.children_3_plus ?? 0) + Number(booking.children_under_3 ?? 0);
  return { adults, children, total: adults + children };
}

function getSouthAfricaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getWeekStart(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const day = date.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

type PeriodSummary = {
  reservations: number;
  adults: number;
  children: number;
  visitors: number;
  revenue: number;
};

const ADMIN_PAGE_SIZE = 25;
const SUMMARY_PAGE_SIZE = 1000;
const TERMINAL_PAYMENT_STATUSES = ["rejected", "cancelled", "failed", "refunded", "refund_failed"];

type SummaryBooking = {
  id: string;
  booking_date: string | null;
  booking_status: string | null;
  payment_status: string | null;
  adults: number | null;
  children_3_plus: number | null;
  children_under_3: number | null;
  total_price: number | null;
};

type PaymentAggregate = {
  paid: number;
  refunded: number;
  validPaid: number;
  status: string | null;
};

type AdminCalendarBooking = {
  id: string;
  customer_name: string | null;
  booking_date: string | null;
  booking_time: string | null;
  adults: number | null;
  children_3_plus: number | null;
  children_under_3: number | null;
  total_price: number | null;
  booking_status: string | null;
  payment_status: string | null;
};

function isActiveBooking(booking: { booking_status?: string | null; payment_status?: string | null }) {
  const bookingStatus = String(booking.booking_status ?? "").trim().toLowerCase();
  const paymentStatus = String(booking.payment_status ?? "").trim().toLowerCase();
  return ["pending", "confirmed"].includes(bookingStatus) && !TERMINAL_PAYMENT_STATUSES.includes(paymentStatus);
}

async function fetchSummaryBookings(supabaseAdmin: ReturnType<typeof getSupabaseAdminClient>, startDate: string, endDate: string) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("id, booking_date, booking_status, payment_status, adults, children_3_plus, children_under_3, total_price")
    .gte("booking_date", startDate)
    .lte("booking_date", endDate)
    .order("booking_date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as SummaryBooking[];
}

async function fetchBookingCount(supabaseAdmin: ReturnType<typeof getSupabaseAdminClient>, apply: (query: any) => any) {
  const query = apply(supabaseAdmin.from("bookings").select("id", { count: "exact", head: true }));
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function fetchPaymentAggregates(supabaseAdmin: ReturnType<typeof getSupabaseAdminClient>, bookingIds: string[]) {
  const lookup: Record<string, PaymentAggregate> = {};

  for (let offset = 0; offset < bookingIds.length; offset += 500) {
    const ids = bookingIds.slice(offset, offset + 500);
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("booking_id, amount, refund_amount, status, created_at")
      .in("booking_id", ids)
      .order("created_at", { ascending: true });

    if (error) throw error;

    for (const payment of data ?? []) {
      const current = lookup[payment.booking_id] ?? { paid: 0, refunded: 0, validPaid: 0, status: null };
      const status = String(payment.status ?? "").trim().toLowerCase();
      if (["paid", "verified", "approved"].includes(status)) current.paid += Math.max(Number(payment.amount ?? 0), 0);
      current.refunded += Math.max(Number(payment.refund_amount ?? 0), 0);
      current.validPaid = Math.max(current.paid - current.refunded, 0);
      current.status = payment.status ?? current.status;
      lookup[payment.booking_id] = current;
    }
  }

  return lookup;
}

async function fetchCalendarBookings(supabaseAdmin: ReturnType<typeof getSupabaseAdminClient>, start: string, end: string) {
  const rows: AdminCalendarBooking[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("id, customer_name, booking_date, booking_time, adults, children_3_plus, children_under_3, total_price, booking_status, payment_status")
      .gte("booking_date", start)
      .lte("booking_date", end)
      .order("booking_date", { ascending: true })
      .order("booking_time", { ascending: true })
      .range(offset, offset + SUMMARY_PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...((data ?? []) as AdminCalendarBooking[]));
    if (!data || data.length < SUMMARY_PAGE_SIZE) break;
    offset += SUMMARY_PAGE_SIZE;
  }

  return rows;
}

async function fetchAdminNotifications(supabaseAdmin: ReturnType<typeof getSupabaseAdminClient>): Promise<AdminNotification[]> {
  const [{ data: newBookings }, { data: pendingPayments }, { data: auditRows }, { data: recentCheckIns }] = await Promise.all([
    supabaseAdmin.from("bookings").select("id, reservation_code, created_at").order("created_at", { ascending: false }).limit(5),
    supabaseAdmin.from("bookings").select("id, reservation_code, updated_at, created_at").in("payment_status", ["under_review", "receipt_uploaded", "pending_payment"]).order("updated_at", { ascending: false }).limit(5),
    supabaseAdmin.from("payment_audit_logs").select("booking_id, new_status, changed_at").order("changed_at", { ascending: false }).limit(10),
    supabaseAdmin.from("bookings").select("id, reservation_code, checked_in_at").eq("checked_in", true).order("checked_in_at", { ascending: false }).limit(5),
  ]);

  const auditBookingIds = [...new Set((auditRows ?? []).map((row) => row.booking_id).filter(Boolean))];
  const { data: auditBookings } = auditBookingIds.length > 0
    ? await supabaseAdmin.from("bookings").select("id, reservation_code").in("id", auditBookingIds)
    : { data: [] };
  const referenceById = new Map((auditBookings ?? []).map((booking) => [booking.id, booking.reservation_code]));
  const notifications: AdminNotification[] = [];

  for (const booking of newBookings ?? []) notifications.push({ id: `booking-${booking.id}`, kind: "booking", title: "New booking received", time: booking.created_at, bookingId: booking.id, reference: booking.reservation_code });
  for (const booking of pendingPayments ?? []) notifications.push({ id: `payment-review-${booking.id}`, kind: "payment", title: "Payment awaiting review", time: booking.updated_at ?? booking.created_at, bookingId: booking.id, reference: booking.reservation_code });
  for (const audit of auditRows ?? []) {
    const status = String(audit.new_status ?? "").toLowerCase();
    const title = status === "approved" ? "Payment approved" : status === "rejected" ? "Payment rejected" : null;
    if (title) notifications.push({ id: `audit-${audit.booking_id}-${audit.changed_at}`, kind: "payment", title, time: audit.changed_at, bookingId: audit.booking_id, reference: referenceById.get(audit.booking_id) ?? null });
  }
  for (const booking of recentCheckIns ?? []) notifications.push({ id: `check-in-${booking.id}-${booking.checked_in_at}`, kind: "check_in", title: "Check-in completed", time: booking.checked_in_at, bookingId: booking.id, reference: booking.reservation_code });

  return notifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 20);
}

function getCalendarMonthRange(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const year = Number(match?.[1] ?? new Date().getUTCFullYear());
  const month = Number(match?.[2] ?? new Date().getUTCMonth() + 1);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

function summarizeBookings(
  bookings: Array<{
    booking_date?: string | null;
    booking_status?: string | null;
    adults?: number | null;
    children_3_plus?: number | null;
    children_under_3?: number | null;
    total_price?: number | null;
  }>,
  startDate: string,
  endDate: string,
): PeriodSummary {
  const included = bookings.filter((booking) => {
    const date = String(booking.booking_date ?? "");
    return isActiveBooking(booking) && date >= startDate && date <= endDate;
  });

  return included.reduce<PeriodSummary>(
    (summary, booking) => {
      const visitors = getVisitorCounts(booking);
      return {
        reservations: summary.reservations + 1,
        adults: summary.adults + visitors.adults,
        children: summary.children + visitors.children,
        visitors: summary.visitors + visitors.total,
        revenue: summary.revenue + Number(booking.total_price ?? 0),
      };
    },
    { reservations: 0, adults: 0, children: 0, visitors: 0, revenue: 0 },
  );
}

function formatDisplayStatusLabel(value: string | null | undefined) {
  const normalized = String(value ?? "pending").trim().toLowerCase();

  if (normalized === "pending") return "Pending";
  if (normalized === "paid") return "Paid";
  if (normalized === "partially_paid") return "Partially Paid";
  if (normalized === "outstanding") return "Outstanding";
  if (normalized === "refund_pending") return "Refund Pending";
  if (normalized === "refunded") return "Refunded";
  if (normalized === "cancelled" || normalized === "canceled") return "Cancelled";
  if (normalized === "confirmed") return "Confirmed";
  if (normalized === "completed") return "Completed";
  if (normalized === "failed") return "Failed";
  if (normalized === "rejected") return "Rejected";

  return formatStatus(value);
}

function formatBookingStatus(status: string | null | undefined) {
  const normalized = String(status ?? "pending").trim().toLowerCase();
  if (normalized === "confirmed" || normalized === "paid") return "Confirmed";
  if (normalized === "cancelled" || normalized === "canceled") return "Cancelled";
  return "Pending";
}

function formatPaymentStatus(status: string | null | undefined) {
  const normalized = String(status ?? "pending").trim().toLowerCase();
  if (normalized === "paid" || normalized === "verified" || normalized === "approved") return "Paid";
  if (normalized === "failed" || normalized === "rejected") return "Failed";
  return "Pending";
}

function isBankTransferMethod(value: string | null | undefined) {
  const normalized = normalizePaymentMethod(value);
  if (!normalized) {
    return false;
  }

  return (
    normalized === "bank_transfer" ||
    normalized === "banktransfer" ||
    normalized === "manual" ||
    normalized === "manual_payment" ||
    normalized === "manual_bank_transfer" ||
    normalized === "manual_bank_payment" ||
    normalized === "bank_transfer_manual" ||
    normalized === "bank_transfer_manual_payment" ||
    normalized === "bank_transfer_payment" ||
    normalized.includes("bank") ||
    (normalized.includes("manual") && normalized.includes("bank"))
  );
}

function isPendingBankTransferBooking(booking: { payment_status?: string | null; payment_method?: string | null }) {
  const paymentStatus = String(booking.payment_status ?? "").trim().toLowerCase();
  if (!paymentStatus) {
    return false;
  }

  const allowedPendingStates = new Set([
    "pending",
    "pending_payment",
    "receipt_required",
    "receipt_uploaded",
    "under_review",
    "manual_review",
    "verification_pending",
  ]);

  if (!allowedPendingStates.has(paymentStatus)) {
    return false;
  }

  return isBankTransferMethod(booking.payment_method);
}

function isIhkokhaMethod(value: string | null | undefined) {
  const normalized = normalizePaymentMethod(value);
  return normalized.includes("ikhokha") || normalized.includes("ikhokha");
}

function formatShortReference(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "—";
  }

  if (raw.length <= 10) {
    return raw;
  }

  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDisplayTime(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  return value;
}

function formatCreatedAt(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getBookingStatusClasses(status: string | null | undefined) {
  const normalized = String(status ?? "pending").trim().toLowerCase();

  if (normalized === "confirmed" || normalized === "paid") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (normalized === "cancelled" || normalized === "canceled") {
    return "border border-rose-200 bg-rose-50 text-rose-700";
  }

  if (normalized === "completed") {
    return "border border-sky-200 bg-sky-50 text-sky-700";
  }

  return "border border-amber-200 bg-amber-50 text-amber-700";
}

function getPaymentStatusClasses(status: string | null | undefined) {
  const normalized = String(status ?? "pending").trim().toLowerCase();

  if (normalized === "paid" || normalized === "verified" || normalized === "approved") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (normalized === "refund_pending") {
    return "border border-orange-200 bg-orange-50 text-orange-700";
  }

  if (normalized === "refunded") {
    return "border border-sky-200 bg-sky-50 text-sky-700";
  }

  return "border border-amber-200 bg-amber-50 text-amber-700";
}

function buildAdminUrl({
  bookingId,
  filter = "all",
  search = "",
  date = "",
  bookingStatus = "",
  paymentStatus = "",
  paymentMethod = "",
  pageSize = "25",
  customerEmail = "",
  areaId = "",
  page = "",
  calendarMonth = "",
}: {
  bookingId?: string | null;
  filter?: string;
  search?: string;
  date?: string;
  bookingStatus?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  pageSize?: string;
  customerEmail?: string;
  areaId?: string;
  page?: string;
  calendarMonth?: string;
}) {
  const params = new URLSearchParams();

  if (filter && filter !== "all") {
    params.set("filter", filter);
  }

  if (search) {
    params.set("search", search);
  }

  if (date) {
    params.set("date", date);
  }

  if (bookingStatus) {
    params.set("bookingStatus", bookingStatus);
  }

  if (paymentStatus) {
    params.set("paymentStatus", paymentStatus);
  }

  if (paymentMethod) {
    params.set("paymentMethod", paymentMethod);
  }

  if (customerEmail) {
    params.set("customerEmail", customerEmail);
  }

  if (areaId) params.set("areaId", areaId);
  if (pageSize && pageSize !== "25") params.set("pageSize", pageSize);
  if (page && page !== "1") params.set("page", page);
  if (calendarMonth) params.set("calendarMonth", calendarMonth);

  if (bookingId) {
    params.set("bookingId", bookingId);
  }

  const queryString = params.toString();
  return queryString ? `/admin?${queryString}` : "/admin";
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{
    bookingId?: string;
    filter?: string;
    search?: string;
    date?: string;
    bookingStatus?: string;
    paymentStatus?: string;
    paymentMethod?: string;
    pageSize?: string;
    customerEmail?: string;
    areaId?: string;
    page?: string;
    calendarMonth?: string;
  }>;
}) {
  try {
    await requireAdminAccess();
  } catch {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};
  const selectedBookingId = typeof params.bookingId === "string" ? params.bookingId : null;
  const activeFilter = typeof params.filter === "string" ? params.filter : "all";
  const searchQuery = typeof params.search === "string" ? params.search.trim().toLowerCase() : "";
  const selectedDate = typeof params.date === "string" ? params.date : "";
  const selectedBookingStatus = typeof params.bookingStatus === "string" ? params.bookingStatus : "";
  const selectedPaymentStatus = typeof params.paymentStatus === "string" ? params.paymentStatus : "";
  const selectedPaymentMethod = typeof params.paymentMethod === "string" ? params.paymentMethod : "";
  const requestedPageSize = Number.parseInt(typeof params.pageSize === "string" ? params.pageSize : "25", 10);
  const pageSize = [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 25;
  const selectedCustomerEmail = typeof params.customerEmail === "string" ? params.customerEmail.trim().toLowerCase() : "";
  const selectedAreaId = typeof params.areaId === "string" ? params.areaId : "";
  const currentPage = Math.max(Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1, 1);
  const today = getSouthAfricaDate();
  const calendarMonth = typeof params.calendarMonth === "string" ? params.calendarMonth : today.slice(0, 7);

  const supabaseAdmin = getSupabaseAdminClient();
  let bookingQuery = supabaseAdmin
    .from("bookings")
    .select("id, reservation_code, customer_name, email, phone_number, booking_date, booking_time, selected_area_id, total_price, booking_status, payment_status, payment_method, selected_equipment_ids, notes, adults, children_3_plus, children_under_3, checked_in, checked_in_at, checked_in_by, created_at", { count: "exact" })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("booking_date", { ascending: false, nullsFirst: false })
    .order("booking_time", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });

  if (selectedDate) bookingQuery = bookingQuery.eq("booking_date", selectedDate);
  if (selectedBookingStatus) bookingQuery = bookingQuery.eq("booking_status", selectedBookingStatus);
  if (selectedPaymentStatus) bookingQuery = bookingQuery.eq("payment_status", selectedPaymentStatus);
  if (selectedPaymentMethod) bookingQuery = bookingQuery.eq("payment_method", selectedPaymentMethod);
  if (selectedAreaId) bookingQuery = bookingQuery.eq("selected_area_id", selectedAreaId);
  if (selectedCustomerEmail) bookingQuery = bookingQuery.eq("email", selectedCustomerEmail);
  if (activeFilter === "pending_payment") bookingQuery = bookingQuery.in("payment_status", ["pending", "pending_payment", "verification_pending"]);
  if (activeFilter === "paid") bookingQuery = bookingQuery.in("payment_status", ["paid", "verified", "confirmed", "approved"]);
  if (activeFilter === "pay_at_gate") bookingQuery = bookingQuery.eq("payment_method", "cash_at_gate");
  if (activeFilter === "today") bookingQuery = bookingQuery.eq("booking_date", today);
  if (activeFilter === "checked_in") bookingQuery = bookingQuery.eq("checked_in", true);
  if (activeFilter === "ikhokha") bookingQuery = bookingQuery.ilike("payment_method", "%ikhokha%");
  if (activeFilter === "bank_transfer") bookingQuery = bookingQuery.or("payment_method.ilike.%bank%,payment_method.eq.manual,payment_method.eq.bank_transfer");
  if (searchQuery) {
    const safeSearch = searchQuery.replace(/[(),]/g, "").replace(/[%*]/g, "");
    if (safeSearch) bookingQuery = bookingQuery.or(`customer_name.ilike.*${safeSearch}*,email.ilike.*${safeSearch}*,reservation_code.ilike.*${safeSearch}*`);
  }

  const { data: bookings, error, count: bookingCount } = await bookingQuery.range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-700">Error</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Unable to load bookings</h1>
          <p className="mt-3 text-slate-600">{error.message}</p>
        </div>
      </main>
    );
  }

  const items = bookings ?? [];
  const totalPages = Math.max(Math.ceil((bookingCount ?? 0) / pageSize), 1);
  const selectedBookingOutsidePage = selectedBookingId && !items.some((booking) => booking.id === selectedBookingId)
    ? (await supabaseAdmin.from("bookings").select("id, reservation_code, customer_name, email, phone_number, booking_date, booking_time, selected_area_id, total_price, booking_status, payment_status, payment_method, selected_equipment_ids, notes, adults, children_3_plus, children_under_3, checked_in, checked_in_at, checked_in_by, created_at").eq("id", selectedBookingId).maybeSingle()).data
    : null;
  const lookupItems = selectedBookingOutsidePage ? [...items, selectedBookingOutsidePage] : items;
  const areaIds = [...new Set(lookupItems.map((booking) => booking.selected_area_id).filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
  const allProductIds = [...new Set(
    lookupItems.flatMap((booking) => {
      const ids: string[] = [];
      if (typeof booking.selected_area_id === "string" && booking.selected_area_id.trim()) ids.push(booking.selected_area_id);
      if (Array.isArray(booking.selected_equipment_ids)) ids.push(...booking.selected_equipment_ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0));
      return ids;
    })
  )];

  const productLookup: Record<string, string> = allProductIds.length
    ? Object.fromEntries(
        (
          await supabaseAdmin
            .from("products")
            .select("id, name")
            .in("id", allProductIds)
        )?.data?.map((product) => [product.id, product.name]) ?? []
      )
    : {};

  const areaLookup: Record<string, string> = Object.fromEntries(
    Object.entries(productLookup).filter(([id]) => areaIds.includes(id))
  );

  const paymentLookup = await fetchPaymentAggregates(supabaseAdmin, lookupItems.map((booking) => booking.id));
  const { data: rescheduleAreas } = await supabaseAdmin
    .from("products")
    .select("id, name")
    .eq("category", "picnic_area")
    .eq("is_active", true)
    .eq("is_bookable", true)
    .order("name", { ascending: true });

  const weekStart = getWeekStart(today);
  const [summaryRows, todayRows, bookingTotal, pendingPayments, confirmedBookings, cancelledBookings, refundPending, payAtGateToday, checkedInToday] = await Promise.all([
    fetchSummaryBookings(supabaseAdmin, weekStart, today),
    fetchSummaryBookings(supabaseAdmin, today, today),
    fetchBookingCount(supabaseAdmin, (query) => query),
    fetchBookingCount(supabaseAdmin, (query) => query.in("payment_status", ["pending", "pending_payment", "verification_pending"])),
    fetchBookingCount(supabaseAdmin, (query) => query.in("booking_status", ["confirmed", "paid", "approved", "verified"])),
    fetchBookingCount(supabaseAdmin, (query) => query.in("booking_status", ["cancelled", "canceled"])),
    fetchBookingCount(supabaseAdmin, (query) => query.eq("payment_status", "refund_pending")),
    fetchBookingCount(supabaseAdmin, (query) => query.eq("booking_date", today).eq("payment_method", "cash_at_gate")),
    fetchBookingCount(supabaseAdmin, (query) => query.eq("checked_in", true).gte("checked_in_at", `${today}T00:00:00+02:00`).lt("checked_in_at", `${today}T23:59:59+02:00`)),
  ]);
  const filteredItems = items;
  const summary = {
    total: bookingTotal,
    pendingPayments,
    confirmed: confirmedBookings,
    cancelled: cancelledBookings,
    refundPending,
  };

  const todaySummary = summarizeBookings(todayRows, today, today);
  const weekSummary = summarizeBookings(summaryRows, weekStart, today);
  const paidTodayRows = todayRows.filter((booking) => ["paid", "verified"].includes(String(booking.payment_status ?? "").toLowerCase()));
  const paidToday = paidTodayRows.length;
  const todayRevenue = paidTodayRows.reduce((total, booking) => total + Number(booking.total_price ?? 0), 0);
  const todayGuests = todayRows.reduce((total, booking) => total + Number(booking.adults ?? 0) + Number(booking.children_3_plus ?? 0) + Number(booking.children_under_3 ?? 0), 0);
  const calendarRange = getCalendarMonthRange(calendarMonth);
  const calendarBookings = await fetchCalendarBookings(supabaseAdmin, calendarRange.start, calendarRange.end);

  const selectedBooking = items.find((booking) => booking.id === selectedBookingId) ?? selectedBookingOutsidePage ?? null;
  const customerHistoryBookings = selectedCustomerEmail
    ? (await supabaseAdmin
        .from("bookings")
        .select("id, reservation_code, customer_name, email, phone_number, booking_date, booking_time, selected_area_id, total_price, booking_status, payment_status, payment_method, adults, children_3_plus, children_under_3")
        .eq("email", selectedCustomerEmail)
        .order("booking_date", { ascending: false }))?.data ?? []
    : [];
  const customerHistoryPaymentLookup = await fetchPaymentAggregates(supabaseAdmin, customerHistoryBookings.map((booking) => booking.id));
  const customerHistoryAreaIds = [...new Set(customerHistoryBookings.map((booking) => booking.selected_area_id).filter((value): value is string => Boolean(value)))];
  const customerHistoryAreaLookup: Record<string, string> = customerHistoryAreaIds.length
    ? Object.fromEntries(((await supabaseAdmin.from("products").select("id, name").in("id", customerHistoryAreaIds)).data ?? []).map((area) => [area.id, area.name]))
    : {};
  const customerBookings = customerHistoryBookings;
  
  // Calculate discount information for selected booking
  const selectedBookingDiscount = selectedBooking && selectedBooking.created_at && selectedBooking.booking_date
    ? getDiscountInfo(
        selectedBooking.total_price || 0,
        selectedBooking.booking_date,
        new Date(selectedBooking.created_at).toISOString().split("T")[0]
      )
    : null;
  
  // Calculate subtotal by reversing the discount
  const selectedBookingSubtotal = selectedBookingDiscount
    ? selectedBookingDiscount.totalAfterDiscount === 0 && selectedBookingDiscount.discountPercentage === 0
      ? selectedBooking?.total_price || 0
      : selectedBookingDiscount.discountPercentage > 0
        ? selectedBookingDiscount.discountAmount + selectedBookingDiscount.totalAfterDiscount
        : selectedBooking?.total_price || 0
    : selectedBooking?.total_price || 0;
  
  const selectedBookingWithDiscount = selectedBooking ? {
    ...selectedBooking,
    subtotal: selectedBookingSubtotal,
    discount_percentage: selectedBookingDiscount?.discountPercentage || 0,
    discount_amount: selectedBookingDiscount?.discountAmount || 0,
  } : null;
  
  const pendingBankTransferBooking = selectedBookingWithDiscount ? isPendingBankTransferBooking(selectedBookingWithDiscount) : false;
  const selectedPayment = selectedBookingWithDiscount
    ? (
        await supabaseAdmin
          .from("payments")
          .select("id, amount, refund_amount, status, provider, receipt_url, receipt_file_name, review_status, reviewed_at, review_note, rejection_reason, verified_by, verified_at")
          .eq("booking_id", selectedBookingWithDiscount.id)
          .eq("provider", "manual")
          .order("receipt_url", { ascending: false, nullsFirst: false })
          .order("updated_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
      )?.data ?? null
    : null;
  const selectedAuditLogs = selectedBookingWithDiscount
    ? (await supabaseAdmin
        .from("payment_audit_logs")
        .select("new_status, changed_at, admin_note, rejection_reason")
        .eq("booking_id", selectedBookingWithDiscount.id)
        .order("changed_at", { ascending: false }))?.data ?? []
    : [];
  const refundAmountDue = Number(selectedPayment?.refund_amount ?? selectedPayment?.amount ?? selectedBookingWithDiscount?.total_price ?? 0);
  const paidAmount = selectedBookingWithDiscount ? (paymentLookup[selectedBookingWithDiscount.id]?.validPaid ?? 0) : 0;
  const outstandingBalance = selectedBookingWithDiscount
    ? Math.max(Number(selectedBookingWithDiscount.total_price ?? 0) - paidAmount, 0)
    : null;
  const additionalServiceNames = selectedBookingWithDiscount
    ? (Array.isArray(selectedBookingWithDiscount.selected_equipment_ids) ? selectedBookingWithDiscount.selected_equipment_ids : [])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => productLookup[value] || "Service")
        .filter(Boolean)
    : [];
  const adminNotifications = await fetchAdminNotifications(supabaseAdmin);
  const activityItems = selectedBookingWithDiscount
    ? [
        ...selectedAuditLogs.map((audit) => ({
          type: String(audit.new_status ?? "").toLowerCase() === "rejected" ? "Payment rejected" : "Payment approved",
          time: audit.changed_at,
          reviewer: selectedPayment?.verified_by ?? null,
          reason: audit.rejection_reason ?? audit.admin_note ?? null,
        })),
        ...(selectedBookingWithDiscount.checked_in && selectedBookingWithDiscount.checked_in_at
          ? [{ type: "Check-in completed", time: selectedBookingWithDiscount.checked_in_at, reviewer: null, reason: null }]
          : []),
      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    : [];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Admin dashboard</p>
            <h1 className="mt-2 hidden text-3xl font-black tracking-tight text-slate-900 md:block">Booking management</h1>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 md:hidden">Bookings <span className="text-emerald-700">({bookingCount ?? 0})</span></h1>
          </div>
          <AdminNotifications notifications={adminNotifications} />
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-[repeat(5,minmax(0,1fr))]">
          {[
            { label: "Total Bookings", value: summary.total, tone: "bg-slate-100 text-slate-700 border-slate-200", icon: "◫" },
            { label: "Pending Payments", value: summary.pendingPayments, tone: "bg-amber-50 text-amber-700 border-amber-200", icon: "◔" },
            { label: "Confirmed", value: summary.confirmed, tone: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "✓" },
            { label: "Cancelled", value: summary.cancelled, tone: "bg-rose-50 text-rose-700 border-rose-200", icon: "−" },
            { label: "Refund Pending", value: summary.refundPending, tone: "bg-orange-50 text-orange-700 border-orange-200", icon: "↺" },
          ].map((card) => (
            <div key={card.label} className={`${card.label === "Refund Pending" ? "col-span-2 sm:col-span-1" : ""} min-w-0 overflow-hidden rounded-2xl border bg-white p-3 shadow-sm sm:p-5 ${card.tone}`}>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 truncate text-sm font-medium">{card.label}</div>
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-white/70 text-base font-bold">{card.icon}</span>
              </div>
              <div className="mt-4 truncate text-3xl font-black leading-none tracking-tight">{card.value}</div>
            </div>
          ))}
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "PENDING PAYMENTS", value: pendingPayments, tone: "border-amber-200 bg-amber-50 text-amber-800" },
            { label: "PAID TODAY", value: paidToday, tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
            { label: "PAY AT GATE TODAY", value: payAtGateToday, tone: "border-orange-200 bg-orange-50 text-orange-800" },
            { label: "TODAY'S GUESTS", value: todayGuests, tone: "border-sky-200 bg-sky-50 text-sky-800" },
            { label: "CHECKED-IN TODAY", value: checkedInToday, tone: "border-teal-200 bg-teal-50 text-teal-800" },
            { label: "TODAY'S REVENUE", value: formatMoney(todayRevenue), tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
          ].map((card) => (
            <div key={card.label} className={`min-w-0 rounded-2xl border p-3 shadow-sm sm:p-4 ${card.tone}`}>
              <div className="truncate text-[10px] font-black uppercase tracking-[0.1em] sm:text-xs">{card.label}</div>
              <div className="mt-3 truncate text-xl font-black sm:text-2xl">{card.value}</div>
            </div>
          ))}
        </div>

        <div className="grid min-w-0 gap-5">
          {[
            { label: "TODAY", summary: todaySummary },
            { label: "THIS WEEK", summary: weekSummary },
          ].map((period) => (
            <section key={period.label} className="min-w-0 overflow-hidden rounded-[2rem] border border-emerald-100 bg-emerald-50/70 p-4 shadow-[0_16px_36px_rgba(16,185,129,0.08)] sm:p-6">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-emerald-100/80 pb-4">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-black uppercase tracking-[0.2em] text-emerald-950">{period.label}</h2>
                  <p className="mt-1 text-xs font-medium text-emerald-800/70">Live booking data</p>
                </div>
                <span className="shrink-0 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-emerald-800">{period.label === "TODAY" ? "Current day" : "Monday to today"}</span>
              </div>
              <div className="mt-5 grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))]">
                <div className="min-w-0 rounded-2xl border border-emerald-100 bg-white p-3 shadow-sm sm:p-5">
                  <div className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Reservations</div>
                  <div className="mt-3 truncate text-2xl font-black leading-none tracking-tight text-slate-900">{period.summary.reservations}</div>
                </div>
                <div className="min-w-0 rounded-2xl border border-emerald-100 bg-white p-3 shadow-sm sm:p-5">
                  <div className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Visitors</div>
                  <div className="mt-3 truncate text-2xl font-black leading-none tracking-tight text-slate-900">{period.summary.visitors}</div>
                </div>
                <div className="min-w-0 rounded-2xl border border-emerald-100 bg-white p-3 shadow-sm sm:p-5">
                  <div className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Adults</div>
                  <div className="mt-3 truncate text-2xl font-black leading-none tracking-tight text-slate-900">{period.summary.adults}</div>
                </div>
                <div className="min-w-0 rounded-2xl border border-emerald-100 bg-white p-3 shadow-sm sm:p-5">
                  <div className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Children</div>
                  <div className="mt-3 truncate text-2xl font-black leading-none tracking-tight text-slate-900">{period.summary.children}</div>
                </div>
                <div className="col-span-2 min-w-0 rounded-2xl border border-emerald-100 bg-white p-3 shadow-sm sm:col-span-2 sm:p-5 lg:col-span-1">
                  <div className="whitespace-normal text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Estimated Revenue</div>
                  <div className="mt-2 whitespace-nowrap text-lg font-black leading-tight tracking-tight text-slate-900 sm:text-xl">{formatMoney(period.summary.revenue)}</div>
                </div>
              </div>
            </section>
          ))}
        </div>

        <ReservationCalendar bookings={calendarBookings} initialMonth={today.slice(0, 7)} />

        <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-[0_15px_35px_rgba(15,23,42,0.03)] sm:p-5">
          <div className="mb-4 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
            {[
              { value: "all", label: "All" },
              { value: "bank_transfer", label: "Bank Transfer" },
              { value: "ikhokha", label: "iKhokha" },
              { value: "pending_payment", label: "Pending Payment" },
              { value: "paid", label: "Paid" },
              { value: "pay_at_gate", label: "Pay at Gate" },
                  { value: "today", label: "Today's Bookings" },
                  { value: "checked_in", label: "Checked In" },
            ].map((filterOption) => {
              const isActive = activeFilter === filterOption.value;
              return (
                <a
                  key={filterOption.value}
                  href={buildAdminUrl({
                    bookingId: selectedBookingId,
                    filter: filterOption.value,
                    search: searchQuery,
                    date: selectedDate,
                    bookingStatus: selectedBookingStatus,
                    paymentStatus: selectedPaymentStatus,
                    paymentMethod: selectedPaymentMethod,
                    pageSize: String(pageSize),
                    page: "1",
                  })}
                  className={`inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold transition ${
                    isActive
                      ? "bg-slate-900 text-white shadow-sm"
                      : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {filterOption.label}
                </a>
              );
            })}
          </div>

          <form method="GET" action="/admin" data-admin-filter-form="true" className="hidden min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7 md:grid">
            <input type="hidden" name="filter" value={activeFilter} />
            <input type="hidden" name="page" value="1" />
            {selectedBookingId && <input type="hidden" name="bookingId" value={selectedBookingId} />}

            <label className="lg:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Search</span>
              <input
                type="search"
                name="search"
                data-admin-search="true"
                defaultValue={searchQuery}
                placeholder="Name, email, reference..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
              />
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Date</span>
              <input
                type="date"
                name="date"
                defaultValue={selectedDate}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
              />
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Per page</span>
              <select name="pageSize" defaultValue={String(pageSize)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white">
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Area</span>
              <select name="areaId" defaultValue={selectedAreaId} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white">
                <option value="">All areas</option>
                {(rescheduleAreas ?? []).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Booking Status</span>
              <select
                name="bookingStatus"
                defaultValue={selectedBookingStatus}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
                <option value="completed">Completed</option>
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Payment Status</span>
              <select
                name="paymentStatus"
                defaultValue={selectedPaymentStatus}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="refund_pending">Refund Pending</option>
                <option value="refunded">Refunded</option>
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Payment Method</span>
              <select
                name="paymentMethod"
                defaultValue={selectedPaymentMethod}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
              >
                <option value="">All</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="ikhokha">iKhokha</option>
                <option value="manual">Manual</option>
                <option value="cash_at_gate">Cash at Gate</option>
              </select>
            </label>

            <div className="grid grid-cols-2 items-end gap-2 sm:col-span-2 lg:col-span-1 lg:flex">
              <button
                type="submit"
                className="inline-flex min-h-11 w-full min-w-0 items-center justify-center rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Apply
              </button>
              <a
                href={buildAdminUrl({ bookingId: selectedBookingId, filter: activeFilter })}
                className="inline-flex min-h-11 w-full min-w-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Clear
              </a>
            </div>
          </form>

          <div className="md:hidden">
            <form method="GET" action="/admin" data-admin-filter-form="true" className="space-y-3">
              <input type="hidden" name="filter" value={activeFilter} />
              <input type="hidden" name="page" value="1" />
              {selectedBookingId && <input type="hidden" name="bookingId" value={selectedBookingId} />}
              <label className="block">
                <span className="sr-only">Search bookings</span>
                <input type="search" name="search" data-admin-search="true" defaultValue={searchQuery} placeholder="Search name, email or booking reference..." className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white" />
              </label>
              <div className="flex items-center gap-2">
                <details className="min-w-0 flex-1">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800">FILTERS</summary>
                  <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Date</span><input type="date" name="date" defaultValue={selectedDate} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" /></label>
                    <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Area</span><select name="areaId" defaultValue={selectedAreaId} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">All areas</option>{(rescheduleAreas ?? []).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
                    <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Booking Status</span><select name="bookingStatus" defaultValue={selectedBookingStatus} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">All</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select></label>
                    <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Payment Status</span><select name="paymentStatus" defaultValue={selectedPaymentStatus} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">All</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="refund_pending">Refund Pending</option><option value="refunded">Refunded</option></select></label>
                    <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Payment Method</span><select name="paymentMethod" defaultValue={selectedPaymentMethod} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">All</option><option value="bank_transfer">Bank Transfer</option><option value="ikhokha">iKhokha</option><option value="manual">Manual</option><option value="cash_at_gate">Cash at Gate</option></select></label>
                    <button type="submit" className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white">APPLY FILTERS</button>
                    <a href={buildAdminUrl({ bookingId: selectedBookingId, filter: activeFilter })} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">CLEAR FILTERS</a>
                  </div>
                </details>
                <label className="shrink-0"><span className="sr-only">Bookings per page</span><select name="pageSize" defaultValue={String(pageSize)} className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
              </div>
            </form>
          </div>
        </div>

        <script dangerouslySetInnerHTML={{ __html: `
          (() => {
            document.querySelectorAll('[data-admin-search="true"]').forEach((input) => {
              let timer;
              input.addEventListener('input', () => {
                window.clearTimeout(timer);
                timer = window.setTimeout(() => input.form?.requestSubmit(), 350);
              });
            });
          })();
        ` }} />

        <div className="hidden overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.05)] md:block">
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] divide-y divide-slate-200 text-left text-sm text-slate-700">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                <tr>
                  <th className="sticky left-0 z-20 bg-slate-50/95 px-4 py-3 font-semibold text-slate-700 shadow-[4px_0_8px_rgba(15,23,42,0.06)]">Action</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Customer</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Booking / Reference</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Created</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Adults</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Children</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Total People</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Area</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Total</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Paid</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Outstanding</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Payment Method</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Payment Status</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Booking Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-4 py-12">
                      <div className="flex flex-col items-center justify-center text-center">
                        <div className="text-lg font-semibold text-slate-900">No bookings found</div>
                        <div className="mt-2 text-sm text-slate-500">Try changing your filters or search.</div>
                      </div>
                    </td>
                  </tr>
                )}

                {filteredItems.map((booking) => {
                  const visitorCounts = getVisitorCounts(booking);
                  const areaName = booking.selected_area_id ? areaLookup[booking.selected_area_id] || "No Picnic Area" : "No Picnic Area";

                  return (
                    <tr key={booking.id} className={`align-top transition-colors hover:bg-emerald-50/30 ${booking.id === filteredItems[0]?.id ? "bg-emerald-50/45" : ""}`}>
                      <td className="sticky left-0 z-[1] bg-white px-5 py-4 shadow-[4px_0_8px_rgba(15,23,42,0.06)]">
                        <a
                          href={buildAdminUrl({ bookingId: booking.id, filter: activeFilter, search: searchQuery, date: selectedDate, bookingStatus: selectedBookingStatus, paymentStatus: selectedPaymentStatus, paymentMethod: selectedPaymentMethod, pageSize: String(pageSize), page: String(currentPage) })}
                          className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          View Details
                        </a>
                      </td>
                      <td className="px-5 py-4">
                        <a href={buildAdminUrl({ customerEmail: booking.email, filter: activeFilter, search: searchQuery, date: selectedDate, bookingStatus: selectedBookingStatus, paymentStatus: selectedPaymentStatus, paymentMethod: selectedPaymentMethod })} className="font-semibold text-emerald-800 hover:text-emerald-950">{booking.customer_name || "Unknown"}</a>
                        <div className="mt-1 text-xs text-slate-500">{booking.email || "No email"}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">{formatShortReference(booking.reservation_code || booking.id)}</div>
                        <div className="mt-1 text-xs text-slate-500">{booking.reservation_code ? "Ref" : "ID"}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">{formatCreatedAt(booking.created_at)}</div>
                      </td>
                      <td className="px-5 py-4 text-slate-700">{visitorCounts.adults}</td>
                      <td className="px-5 py-4 text-slate-700">{visitorCounts.children}</td>
                      <td className="px-5 py-4 text-slate-700">{visitorCounts.total}</td>
                      <td className="max-w-44 px-5 py-4 text-slate-700"><span className="block truncate" title={areaName}>{areaName}</span></td>
                      <td className="px-5 py-4 font-semibold text-slate-900">{formatMoney(booking.total_price)}</td>
                      <td className="px-5 py-4 font-semibold text-slate-900">{formatMoney(paymentLookup[booking.id]?.validPaid ?? 0)}</td>
                      <td className="px-5 py-4 font-semibold text-slate-900">{formatMoney(Math.max(Number(booking.total_price ?? 0) - (paymentLookup[booking.id]?.validPaid ?? 0), 0))}</td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">{formatPaymentMethod(booking.payment_method)}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getPaymentStatusClasses(booking.payment_status)}`}>
                          {formatPaymentStatus(booking.payment_status)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getBookingStatusClasses(booking.booking_status)}`}>
                          {formatBookingStatus(booking.booking_status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 md:hidden">
          {filteredItems.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-12 text-center shadow-sm">
              <div className="text-base font-semibold text-slate-900">No bookings found</div>
              <div className="mt-2 text-sm text-slate-500">Try changing your filters or search.</div>
            </div>
          )}

          {filteredItems.map((booking, index) => {
            const visitorCounts = getVisitorCounts(booking);
            const areaName = booking.selected_area_id ? areaLookup[booking.selected_area_id] || "No Picnic Area" : "No Picnic Area";

            return (
              <article key={booking.id} className={`min-w-0 overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${index === 0 ? "border-emerald-300 ring-1 ring-emerald-100" : "border-slate-200"}`}>
                <div className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <a href={buildAdminUrl({ customerEmail: booking.email, filter: activeFilter, search: searchQuery, date: selectedDate, bookingStatus: selectedBookingStatus, paymentStatus: selectedPaymentStatus, paymentMethod: selectedPaymentMethod })} className="block truncate text-base font-bold text-emerald-800 hover:text-emerald-950" title="View customer history">{booking.customer_name || "Unknown"}</a>
                    <div className="mt-1 truncate text-xs text-slate-500" title={booking.email || "No email"}>{booking.email || "No email"}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                    <a href={buildAdminUrl({ bookingId: booking.id, filter: activeFilter, search: searchQuery, date: selectedDate, bookingStatus: selectedBookingStatus, paymentStatus: selectedPaymentStatus, paymentMethod: selectedPaymentMethod, pageSize: String(pageSize), page: String(currentPage) })} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black uppercase tracking-wide text-white">VIEW DETAILS</a>
                    <div className="text-xs font-semibold text-slate-500">Reference</div>
                    <div className="mt-1 max-w-28 truncate text-sm font-bold text-slate-900" title={booking.reservation_code || booking.id}>{formatShortReference(booking.reservation_code || booking.id)}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="min-w-0 overflow-hidden"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Created</div><div className="mt-1 break-words font-semibold leading-5 text-slate-900">{formatCreatedAt(booking.created_at)}</div></div>
                  <div className="min-w-0 overflow-hidden"><div className="text-xs text-slate-500">Area</div><div className="mt-1 truncate font-semibold text-slate-900" title={areaName}>{areaName}</div></div>
                  <div><div className="text-xs text-slate-500">Adults</div><div className="mt-1 font-semibold text-slate-900">{visitorCounts.adults}</div></div>
                  <div><div className="text-xs text-slate-500">Children</div><div className="mt-1 font-semibold text-slate-900">{visitorCounts.children}</div></div>
                  <div><div className="text-xs text-slate-500">Total people</div><div className="mt-1 font-semibold text-slate-900">{visitorCounts.total}</div></div>
                  <div><div className="text-xs text-slate-500">Total</div><div className="mt-1 font-semibold text-slate-900">{formatMoney(booking.total_price)}</div></div>
                  <div><div className="text-xs text-slate-500">Paid</div><div className="mt-1 font-semibold text-slate-900">{formatMoney(paymentLookup[booking.id]?.validPaid ?? 0)}</div></div>
                  <div><div className="text-xs text-slate-500">Outstanding</div><div className="mt-1 font-semibold text-slate-900">{formatMoney(Math.max(Number(booking.total_price ?? 0) - (paymentLookup[booking.id]?.validPaid ?? 0), 0))}</div></div>
                </div>
                <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <span className={`max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getPaymentStatusClasses(booking.payment_status)}`}>{formatPaymentStatus(booking.payment_status)}</span>
                  <span className={`max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getBookingStatusClasses(booking.booking_status)}`}>{formatBookingStatus(booking.booking_status)}</span>
                  <span className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{formatPaymentMethod(booking.payment_method)}</span>
                  {booking.checked_in && <span className="max-w-full truncate rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">✓ Checked in</span>}
                </div>
              </article>
            );
          })}
        </div>

        {totalPages > 1 && (
          <nav className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm" aria-label="Reservation pages">
            <span className="text-slate-500"><span className="md:hidden">Showing {items.length} of {bookingCount ?? 0} bookings · </span>Page {currentPage} of {totalPages}<span className="hidden md:inline"> · {bookingCount ?? 0} reservations</span></span>
            <div className="flex min-w-0 gap-2">
              {currentPage > 1 && <a href={buildAdminUrl({ filter: activeFilter, search: searchQuery, date: selectedDate, bookingStatus: selectedBookingStatus, paymentStatus: selectedPaymentStatus, paymentMethod: selectedPaymentMethod, areaId: selectedAreaId, page: String(currentPage - 1), pageSize: String(pageSize), calendarMonth })} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50"><span className="md:hidden">← Previous</span><span className="hidden md:inline">Previous</span></a>}
              {currentPage < totalPages && <a href={buildAdminUrl({ filter: activeFilter, search: searchQuery, date: selectedDate, bookingStatus: selectedBookingStatus, paymentStatus: selectedPaymentStatus, paymentMethod: selectedPaymentMethod, areaId: selectedAreaId, page: String(currentPage + 1), pageSize: String(pageSize), calendarMonth })} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50"><span className="md:hidden">Next →</span><span className="hidden md:inline">Next</span></a>}
            </div>
          </nav>
        )}
      </div>

      {selectedCustomerEmail && (
        <section className="mt-6 min-w-0 overflow-hidden rounded-[2rem] border border-emerald-100 bg-emerald-50/60 p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Customer history</p>
              <h2 className="mt-2 truncate text-2xl font-black text-slate-900">{customerBookings[0]?.customer_name || "Customer"}</h2>
              <p className="mt-1 truncate text-sm text-slate-600">{customerBookings[0]?.email || selectedCustomerEmail} · {customerBookings[0]?.phone_number || "No phone recorded"}</p>
            </div>
            <a href={buildAdminUrl({ filter: activeFilter, search: searchQuery, date: selectedDate, bookingStatus: selectedBookingStatus, paymentStatus: selectedPaymentStatus, paymentMethod: selectedPaymentMethod })} className="shrink-0 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800">Close</a>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-emerald-100 bg-white p-4"><div className="text-xs text-slate-500">Total bookings</div><div className="mt-1 text-2xl font-black text-slate-900">{customerBookings.length}</div></div>
            <div className="rounded-2xl border border-emerald-100 bg-white p-4"><div className="text-xs text-slate-500">Total spent</div><div className="mt-1 text-lg font-black text-slate-900">{formatMoney(customerBookings.reduce((total, booking) => total + Number(booking.total_price ?? 0), 0))}</div></div>
            <div className="col-span-2 rounded-2xl border border-emerald-100 bg-white p-4 sm:col-span-1"><div className="text-xs text-slate-500">Previous bookings</div><div className="mt-1 text-2xl font-black text-slate-900">{Math.max(customerBookings.length - 1, 0)}</div></div>
          </div>
          <div className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {customerBookings.map((booking) => {
              const payment = customerHistoryPaymentLookup[booking.id];
              const outstanding = Math.max(Number(booking.total_price ?? 0) - (payment?.validPaid ?? 0), 0);
              const visitors = getVisitorCounts(booking);
              const areaName = customerHistoryAreaLookup[booking.selected_area_id ?? ""] || "No Picnic Area";
              return <div key={booking.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3 text-sm"><span className="shrink-0 font-semibold text-slate-500">{formatDisplayDate(booking.booking_date)} · {formatDisplayTime(booking.booking_time)}</span><span className="min-w-0 flex-1 truncate font-semibold text-slate-900" title={areaName}>{formatShortReference(booking.reservation_code || booking.id)} · {areaName} · {visitors.total} guests</span><span className="shrink-0 font-semibold text-slate-700">{formatMoney(booking.total_price)} / {formatMoney(payment?.validPaid ?? 0)} / {formatMoney(outstanding)}</span><span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${getBookingStatusClasses(booking.booking_status)}`}>{formatBookingStatus(booking.booking_status)}</span></div>;
            })}
          </div>
        </section>
      )}

      {selectedBookingWithDiscount && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-3 sm:items-center sm:p-6">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.1)]">
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Booking details</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">{selectedBookingWithDiscount.customer_name || "Customer booking"}</h2>
              </div>
              <a
                href={buildAdminUrl({ filter: activeFilter, search: searchQuery, date: selectedDate, bookingStatus: selectedBookingStatus, paymentStatus: selectedPaymentStatus, paymentMethod: selectedPaymentMethod })}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </a>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getBookingStatusClasses(selectedBookingWithDiscount.booking_status)}`}>
                    {formatBookingStatus(selectedBookingWithDiscount.booking_status).toUpperCase()}
                  </span>
                  <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                    {formatPaymentMethod(selectedBookingWithDiscount.payment_method)}
                  </span>
                  <span className="ml-auto text-base font-black tracking-tight text-slate-900">{formatMoney(selectedBookingWithDiscount.total_price)}</span>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
                  <div><span className="text-slate-500">Booking Status:</span> <span className="font-medium text-slate-900">{formatBookingStatus(selectedBookingWithDiscount.booking_status)}</span></div>
                  <div><span className="text-slate-500">Payment Status:</span> <span className="font-medium text-slate-900">{formatDisplayStatusLabel(selectedBookingWithDiscount.payment_status)}</span></div>
                  <div><span className="text-slate-500">Payment Method:</span> <span className="font-medium text-slate-900">{formatPaymentMethod(selectedBookingWithDiscount.payment_method)}</span></div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Booking Summary</div>
                  <div className="mt-3 space-y-3 text-sm text-slate-700">
                    <div><span className="text-slate-500">Reference:</span> <span className="font-medium text-slate-900">{selectedBookingWithDiscount.reservation_code || formatShortReference(selectedBookingWithDiscount.id)}</span></div>
                    <div><span className="text-slate-500">Customer:</span> <span className="font-medium text-slate-900">{selectedBookingWithDiscount.customer_name || "Unknown"}</span></div>
                    <div><span className="text-slate-500">Date:</span> <span className="font-medium text-slate-900">{formatDisplayDate(selectedBookingWithDiscount.booking_date)}</span></div>
                    <div><span className="text-slate-500">Status:</span> <span className={`ml-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getBookingStatusClasses(selectedBookingWithDiscount.booking_status)}`}>{formatBookingStatus(selectedBookingWithDiscount.booking_status)}</span></div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Payment Summary</div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                    <div><span className="text-slate-500">Total:</span> <span className="font-medium text-slate-900">{formatMoney(selectedBookingWithDiscount.total_price)}</span></div>
                    <div><span className="text-slate-500">Paid:</span> <span className="font-medium text-slate-900">{selectedPayment?.amount ? formatMoney(Number(selectedPayment.amount)) : "Not available"}</span></div>
                    <div><span className="text-slate-500">Outstanding:</span> <span className="font-medium text-slate-900">{outstandingBalance !== null ? formatMoney(outstandingBalance) : "Not available"}</span></div>
                    <div><span className="text-slate-500">Status:</span> <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getPaymentStatusClasses(selectedBookingWithDiscount.payment_status)}`}>{formatDisplayStatusLabel(selectedBookingWithDiscount.payment_status)}</span></div>
                    <div><span className="text-slate-500">Review:</span> <span className="font-medium text-slate-900">{formatDisplayStatusLabel(selectedPayment?.review_status)}</span></div>
                    {selectedPayment?.rejection_reason && <div className="sm:col-span-2"><span className="text-slate-500">Rejection reason:</span> <span className="font-medium text-rose-800">{selectedPayment.rejection_reason}</span></div>}
                    {selectedPayment?.reviewed_at && <div><span className="text-slate-500">Reviewed:</span> <span className="font-medium text-slate-900">{formatCreatedAt(selectedPayment.reviewed_at)}</span></div>}
                    {selectedPayment?.verified_by && <div><span className="text-slate-500">Reviewed by:</span> <span className="font-medium text-slate-900">{selectedPayment.verified_by}</span></div>}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Booking Information</div>
                  <div className="mt-3 space-y-3 text-sm text-slate-700">
                    <div><span className="text-slate-500">Area booked:</span> <span className="font-medium text-slate-900">{selectedBookingWithDiscount.selected_area_id ? areaLookup[selectedBookingWithDiscount.selected_area_id] || "No Picnic Area" : "No Picnic Area"}</span></div>
                    <div><span className="text-slate-500">Type of booking / function:</span> <span className="font-medium text-slate-900">Not specified</span></div>
                    <div><span className="text-slate-500">Guests:</span> <span className="font-medium text-slate-900">{formatGuestCount(selectedBookingWithDiscount)}</span></div>
                    <div><span className="text-slate-500">Arrival time:</span> <span className="font-medium text-slate-900">Not specified</span></div>
                    <div><span className="text-slate-500">Departure time:</span> <span className="font-medium text-slate-900">Not specified</span></div>
                    <div><span className="text-slate-500">Special requirements:</span> <span className="font-medium text-slate-900">{selectedBookingWithDiscount.notes || "Not specified"}</span></div>
                    <div><span className="text-slate-500">Additional services required:</span> <span className="font-medium text-slate-900">{additionalServiceNames.length > 0 ? additionalServiceNames.join(", ") : "Not specified"}</span></div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Payment Information</div>
                  <div className="mt-3 space-y-3 text-sm text-slate-700">
                    <div><span className="text-slate-500">Subtotal (before discount):</span> <span className="font-medium text-slate-900">{formatMoney(selectedBookingWithDiscount.subtotal || selectedBookingWithDiscount.total_price)}</span></div>
                    <div><span className="text-slate-500">Discount Percentage:</span> <span className="font-medium text-slate-900">{selectedBookingWithDiscount.discount_percentage ? `${selectedBookingWithDiscount.discount_percentage}%` : "0%"}</span></div>
                    <div><span className="text-slate-500">Discount Amount:</span> <span className="font-medium text-slate-900">{formatMoney(selectedBookingWithDiscount.discount_amount || 0)}</span></div>
                    <div><span className="text-slate-500">Total After Discount:</span> <span className="font-medium text-slate-900 font-bold">{formatMoney(selectedBookingWithDiscount.total_price)}</span></div>
                    <div><span className="text-slate-500">Deposit Paid:</span> <span className="font-medium text-slate-900">Not available</span></div>
                    <div><span className="text-slate-500">Outstanding Balance:</span> <span className="font-medium text-slate-900">{outstandingBalance !== null ? formatMoney(outstandingBalance) : "Not available"}</span></div>
                    <div><span className="text-slate-500">Payment Due Date:</span> <span className="font-medium text-slate-900">Not available</span></div>
                    <div><span className="text-slate-500">Payment Received Date:</span> <span className="font-medium text-slate-900">Not available</span></div>
                    <div><span className="text-slate-500">Payment Method:</span> <span className="font-medium text-slate-900">{formatPaymentMethod(selectedBookingWithDiscount.payment_method)}</span></div>
                    <div><span className="text-slate-500">Payment Status:</span> <span className={`ml-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getPaymentStatusClasses(selectedBookingWithDiscount.payment_status)}`}>{formatDisplayStatusLabel(selectedBookingWithDiscount.payment_status)}</span></div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Notes / Special Requirements</div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{selectedBookingWithDiscount.notes || "No extra notes."}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="text-sm font-semibold text-slate-900">Check-in</div>
                <p className="mt-2 font-medium text-slate-700">{selectedBookingWithDiscount.checked_in ? `✓ Checked in${selectedBookingWithDiscount.checked_in_at ? ` · ${formatCreatedAt(selectedBookingWithDiscount.checked_in_at)}` : ""}` : "Not checked in"}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Activity / Audit</div>
                {activityItems.length === 0 ? <p className="mt-3 text-sm text-slate-500">NO ACTIVITY YET</p> : <div className="mt-4 space-y-4">{activityItems.map((activity, index) => <div key={`${activity.type}-${activity.time}-${index}`} className="relative pl-6 text-sm"><span className="absolute left-0 top-1.5 h-3 w-3 rounded-full bg-emerald-600 ring-4 ring-emerald-50" /><div className="font-bold text-slate-900">{activity.type}</div>{activity.reviewer && <div className="mt-1 text-slate-600">Reviewed by: {activity.reviewer}</div>}{activity.reason && <div className="mt-1 text-slate-600">Reason: {activity.reason}</div>}<div className="mt-1 text-xs text-slate-500">{formatCreatedAt(activity.time)}</div>{index < activityItems.length - 1 && <span className="absolute left-[5px] top-5 h-[calc(100%+1rem)] w-px bg-emerald-100" />}</div>)}</div>}
              </div>

              <form action={`/api/admin/bookings/${selectedBookingWithDiscount.id}/reschedule`} method="POST" className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                <div className="text-sm font-semibold text-emerald-950">Reschedule booking</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="min-w-0 text-sm font-medium text-slate-700">Date<input name="bookingDate" type="date" defaultValue={selectedBookingWithDiscount.booking_date ?? ""} required className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" /></label>
                  <label className="min-w-0 text-sm font-medium text-slate-700">Time<input name="bookingTime" type="time" defaultValue={selectedBookingWithDiscount.booking_time?.slice(0, 5) ?? ""} required className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" /></label>
                  <label className="min-w-0 text-sm font-medium text-slate-700">Area<select name="areaId" defaultValue={selectedBookingWithDiscount.selected_area_id ?? ""} required className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="" disabled>Select area</option>{(rescheduleAreas ?? []).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
                </div>
                <button type="submit" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 sm:w-auto">Save new schedule</button>
              </form>
            </div>

            <div className="border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                {selectedBookingWithDiscount.payment_method === "cash_at_gate" && !["paid", "confirmed"].includes(selectedBookingWithDiscount.payment_status ?? "") && (
                  <form
                    action={`/api/admin/bookings/${selectedBookingWithDiscount.id}/payment/confirm`} method="POST"
                    data-review-form="true"
                    data-review-action="approve"
                    data-booking-id={selectedBookingWithDiscount.id}
                  >
                    <button type="submit" className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700">
                      Confirm Payment
                    </button>
                  </form>
                )}

                {pendingBankTransferBooking && (
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                    <button
                      type="button"
                      data-confirm-payment-button="true"
                      data-booking-id={selectedBookingWithDiscount.id}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      Approve Payment
                    </button>
                    <form action={`/api/admin/bookings/${selectedBookingWithDiscount.id}/payment/review`} method="POST" data-payment-rejection-form="true" className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                      <input type="hidden" name="action" value="reject" />
                      <input name="rejectionReason" required placeholder="Rejection reason" className="min-h-11 min-w-0 rounded-xl border border-rose-200 bg-rose-50 px-3 text-sm text-slate-900 placeholder:text-rose-400" />
                      <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700">Reject Payment</button>
                    </form>
                  </div>
                )}

                <form action={`/api/admin/bookings/${selectedBookingWithDiscount.id}/cancel`} method="POST" className="flex items-center gap-2">
                  <button
                    type="button"
                    data-cancel-booking-button="true"
                    className="inline-flex items-center justify-center rounded-full bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    Cancel Booking
                  </button>
                </form>

                {selectedPayment?.receipt_url && (
                  <a
                    href={`/api/admin/bookings/${selectedBookingWithDiscount.id}/receipt`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    View Receipt
                  </a>
                )}
                {!selectedPayment?.receipt_url && (
                  <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-500">
                    No receipt uploaded
                  </span>
                )}
              </div>
            </div>

            <script dangerouslySetInnerHTML={{
              __html: `
                (() => {
                  const totalAmount = Number(${Number(selectedBookingWithDiscount?.total_price ?? 0)});
                  const refundModeInputs = document.querySelectorAll('input[name="refundMode"]');
                  const refundAmountInput = document.getElementById('refundAmount');
                  const refundAmountRequired = document.getElementById('refundAmountRequired');

                  const updateRefundAmountText = () => {
                    const refundMode = Array.from(refundModeInputs).find((input) => input.checked)?.value ?? 'full';
                    const partialValue = Number(refundAmountInput?.value ?? 0);
                    const amount = refundMode === 'partial' ? partialValue : totalAmount;
                    if (refundAmountRequired) {
                      refundAmountRequired.textContent = 'R' + Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : '0.00';
                    }
                  };

                  refundModeInputs.forEach((input) => input.addEventListener('change', updateRefundAmountText));
                  refundAmountInput?.addEventListener('input', updateRefundAmountText);
                  updateRefundAmountText();

                  document.addEventListener('click', async (event) => {
                    const target = event.target instanceof Element ? event.target.closest('[data-confirm-payment-button="true"]') : null;
                    if (!target || !(target instanceof HTMLElement)) {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    const bookingId = target.getAttribute('data-booking-id');
                    if (!bookingId) {
                      return;
                    }

                    const paymentNotice = document.getElementById('payment-confirmation-message');
                    const originalText = target.textContent || 'Confirm Payment';

                    target.disabled = true;
                    target.textContent = 'Confirming payment...';

                    if (paymentNotice) {
                      paymentNotice.hidden = true;
                      paymentNotice.textContent = '';
                      paymentNotice.className = 'mt-4 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-700';
                    }

                    const requestUrl = '/api/admin/bookings/' + encodeURIComponent(bookingId) + '/payment/review';
                    console.log('Confirm payment request URL:', requestUrl);

                    try {
                      const formData = new FormData();
                      formData.append('action', 'approve');

                      console.log('Confirm payment request method: POST');
                      console.log('Confirm payment request body:', { action: 'approve' });

                      const response = await fetch(requestUrl, {
                        method: 'POST',
                        body: formData,
                      });

                      const responseText = await response.text();
                      let responseJson = {};
                      try {
                        responseJson = responseText ? JSON.parse(responseText) : {};
                      } catch {
                        responseJson = {};
                      }

                      console.log('Confirm payment response status:', response.status);
                      console.log('Confirm payment response JSON:', responseJson);

                      if (!response.ok) {
                        const errorMessage = responseJson?.error || responseJson?.message || 'Payment confirmation failed.';
                        const messageText = 'Payment confirmation failed: ' + errorMessage;

                        if (paymentNotice) {
                          paymentNotice.textContent = messageText;
                          paymentNotice.hidden = false;
                          paymentNotice.className = 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700';
                        } else {
                          alert(messageText);
                        }
                        return;
                      }

                      const paymentStatusNode = document.querySelector('[data-payment-status-display]');
                      const bookingStatusNode = document.querySelector('[data-booking-status-display]');
                      if (paymentStatusNode) {
                        paymentStatusNode.textContent = 'Paid';
                      }
                      if (bookingStatusNode) {
                        bookingStatusNode.textContent = 'Confirmed';
                      }

                      const paymentPanel = document.querySelector('[data-confirm-payment-panel]');
                      if (paymentPanel) {
                        paymentPanel.classList.add('border-emerald-300');
                      }

                      if (paymentNotice) {
                        paymentNotice.textContent = responseJson?.emailSent === false
                          ? 'Payment approved, but confirmation email could not be sent.'
                          : 'Payment approved successfully. Confirmation email sent.';
                        paymentNotice.hidden = false;
                        paymentNotice.className = 'mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700';
                      }

                      const successText = responseJson?.emailSent === false
                        ? 'Payment approved, but confirmation email could not be sent.'
                        : 'Payment approved successfully. Confirmation email sent.';
                      console.log(successText);
                      target.textContent = successText;
                      target.disabled = true;
                    } catch (error) {
                      console.error('Confirm payment failed:', error);
                      const messageText = 'Payment confirmation failed: Network or server error.';

                      if (paymentNotice) {
                        paymentNotice.textContent = messageText;
                        paymentNotice.hidden = false;
                        paymentNotice.className = 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700';
                      } else {
                        alert(messageText);
                      }

                      target.textContent = originalText;
                      target.disabled = false;
                    }
                  });

                  document.addEventListener('submit', async (event) => {
                    const form = event.target instanceof HTMLFormElement ? event.target.closest('[data-payment-rejection-form="true"]') : null;
                    if (!form) return;

                    event.preventDefault();
                    const button = form.querySelector('button[type="submit"]');
                    const rejectionNotice = document.getElementById('payment-confirmation-message');
                    if (button instanceof HTMLButtonElement) {
                      button.disabled = true;
                      button.textContent = 'Rejecting payment...';
                    }

                    try {
                      const response = await fetch(form.action, { method: 'POST', body: new FormData(form) });
                      const responseJson = await response.json().catch(() => ({}));
                      if (!response.ok) throw new Error(responseJson?.error || 'Payment rejection failed.');
                      if (rejectionNotice) {
                        rejectionNotice.textContent = responseJson?.emailSent === false
                          ? 'Payment rejected, but rejection email could not be sent.'
                          : 'Payment rejected. Rejection email sent.';
                        rejectionNotice.hidden = false;
                        rejectionNotice.className = 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700';
                      }
                      if (button instanceof HTMLButtonElement) button.textContent = 'Payment rejected';
                    } catch (error) {
                      if (rejectionNotice) {
                        rejectionNotice.textContent = error instanceof Error ? error.message : 'Payment rejection failed.';
                        rejectionNotice.hidden = false;
                        rejectionNotice.className = 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700';
                      }
                      if (button instanceof HTMLButtonElement) {
                        button.disabled = false;
                        button.textContent = 'Reject Payment';
                      }
                    }
                  });

                  document.addEventListener('click', async (event) => {
                    const cancelTarget = event.target instanceof Element ? event.target.closest('[data-cancel-booking-button="true"]') : null;
                    if (!cancelTarget || !(cancelTarget instanceof HTMLElement)) {
                      return;
                    }

                    const cancelForm = cancelTarget.closest('form');
                    if (!cancelForm) {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    const cancelNotice = document.getElementById('cancel-booking-message');
                    const cancelOriginalText = cancelTarget.textContent || 'Cancel Booking';

                    cancelTarget.disabled = true;
                    cancelTarget.textContent = 'Cancelling booking...';

                    if (cancelNotice) {
                      cancelNotice.hidden = true;
                      cancelNotice.textContent = '';
                      cancelNotice.className = 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700';
                    }

                    const requestUrl = cancelForm.action;
                    const formData = new FormData(cancelForm);
                    console.log('Cancel booking request URL:', requestUrl);
                    console.log('Cancel booking request method: POST');
                    console.log('Cancel booking request body:', Object.fromEntries(formData.entries()));

                    try {
                      const response = await fetch(requestUrl, {
                        method: 'POST',
                        body: formData,
                      });

                      const responseText = await response.text();
                      let responseJson = {};
                      try {
                        responseJson = responseText ? JSON.parse(responseText) : {};
                      } catch {
                        responseJson = {};
                      }

                      console.log('Cancel booking response status:', response.status);
                      console.log('Cancel booking response JSON:', responseJson);

                      if (!response.ok) {
                        const errorMessage = responseJson?.error || responseJson?.message || 'Booking cancellation failed.';
                        const messageText = 'Booking cancellation failed: ' + errorMessage;
                        if (cancelNotice) {
                          cancelNotice.textContent = messageText;
                          cancelNotice.hidden = false;
                          cancelNotice.className = 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700';
                        } else {
                          alert(messageText);
                        }
                        return;
                      }

                      if (cancelNotice) {
                        cancelNotice.textContent = 'Booking cancelled successfully.';
                        cancelNotice.hidden = false;
                        cancelNotice.className = 'mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700';
                      }

                      cancelTarget.textContent = 'Booking cancelled successfully.';
                      cancelTarget.disabled = true;
                    } catch (error) {
                      console.error('Cancel booking failed:', error);
                      const messageText = 'Booking cancellation failed: Network or server error.';
                      if (cancelNotice) {
                        cancelNotice.textContent = messageText;
                        cancelNotice.hidden = false;
                        cancelNotice.className = 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700';
                      } else {
                        alert(messageText);
                      }

                      cancelTarget.textContent = cancelOriginalText;
                      cancelTarget.disabled = false;
                    }
                  });
                })();
              `,
            }} />
          </div>
        </div>
      )}
    </main>
  );
}
