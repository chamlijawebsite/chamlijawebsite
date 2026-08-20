"use client";

import { QRCodeSVG } from "qrcode.react";
import { useRef } from "react";

type CheckInQrProps = {
  token: string | null | undefined;
  paymentStatus: string | null | undefined;
  whatsappUrl?: string;
};

export function CheckInQr({ token, paymentStatus, whatsappUrl }: CheckInQrProps) {
  const qrCodeRef = useRef<HTMLDivElement>(null);
  if (!token) return null;

  const checkInUrl = `https://part8-chamlija.vercel.app/gate/check-in?token=${encodeURIComponent(token)}`;
  const normalizedPaymentStatus = String(paymentStatus ?? "pending").trim().toLowerCase();
  const paymentConfirmed = ["paid", "verified"].includes(normalizedPaymentStatus);

  function downloadQrCode() {
    const svg = qrCodeRef.current?.querySelector("svg");
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 660;
      canvas.height = 660;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(svgUrl);
        return;
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(svgUrl);

      const link = document.createElement("a");
      link.download = "chamlija-check-in-qr.png";
      link.href = canvas.toDataURL("image/png");
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    image.src = svgUrl;
  }

  return (
    <div className="mt-6 rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-5 text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Gate Check-in QR</div>
      <div ref={qrCodeRef} className="mx-auto mt-4 w-fit rounded-2xl bg-white p-3 shadow-sm">
        <QRCodeSVG value={checkInUrl} size={220} level="M" includeMargin aria-label="Reservation gate check-in QR code" />
      </div>
      <button type="button" onClick={downloadQrCode} className="mt-4 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-base font-black uppercase tracking-wide text-white shadow-lg transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-300">
        ⬇️ DOWNLOAD QR CODE
      </button>
      {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer" className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-3 rounded-xl border border-[#178a4b] bg-[#176b3c] px-4 py-2 text-white shadow-[0_10px_24px_rgba(23,107,60,0.2)] transition hover:bg-[#145d35] focus:outline-none focus:ring-4 focus:ring-emerald-200">
        <span aria-hidden="true" className="text-2xl leading-none">💬</span>
        <span className="text-left"><span className="block text-sm font-black sm:text-base">Send reservation details via WhatsApp</span><span className="mt-0.5 block text-xs font-medium text-emerald-100">Reservation details + QR access link</span></span>
      </a>}
      <div className="mt-4 rounded-2xl border-2 border-amber-500 bg-amber-100 p-5 text-left shadow-md sm:p-6">
        <p className="text-base font-black uppercase leading-6 tracking-wide text-amber-950 sm:text-lg">⚠️ IMPORTANT — SAVE YOUR QR CODE</p>
        <p className="mt-3 text-sm font-bold leading-6 text-amber-950 sm:text-base">You MUST show this QR code to our gate staff when you arrive at Chamlija.</p>
        <p className="mt-3 text-sm leading-6 text-amber-950 sm:text-base">Download it to your phone OR take a screenshot now and keep it safely. If you cannot show your QR code at the gate, entry may be refused.</p>
      </div>
      {!paymentConfirmed && <p className="mt-4 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-left text-sm font-bold leading-6 text-amber-950">⚠️ Payment verification is still pending. Entry will only be available after your payment has been confirmed.</p>}
    </div>
  );
}
