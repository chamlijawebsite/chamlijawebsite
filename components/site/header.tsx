"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LANGUAGES, getLanguageMeta, type LanguageCode } from "@/locales";
import { useLanguage } from "@/components/site/language-provider";
import { CHAMLIJA_LOCATION, CHAMLIJA_MAPS_URL } from "@/lib/location";

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 1 0 20" />
      <path d="M2 12h20" />
      <path d="M12 2c-1.66 2.5-2 6-2 10s0.34 7.5 2 10" />
      <path d="M12 2c1.66 2.5 2 6 2 10s-0.34 7.5-2 10" />
    </svg>
  );
}

export function SiteHeader() {
  const { language, setLanguage, t } = useLanguage();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const lastScrollY = useRef(0);
  const languagePanelRef = useRef<HTMLDivElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeAllMenus = () => {
    setIsMenuOpen(false);
    setIsLanguageOpen(false);
  };

  const contactItems = [
    { label: "Phone", value: "+27 65 585 9178", href: "tel:+27655859178" },
    { label: "WhatsApp", value: "Chat on WhatsApp", href: "https://wa.me/27655859178?text=Hi%20Chamlija" },
    { label: "Email", value: "buyukchamlija@uict.org.za", href: "mailto:buyukchamlija@uict.org.za" },
    { label: "Location", value: CHAMLIJA_LOCATION.address, href: CHAMLIJA_MAPS_URL },
  ];

  const NAV_LINKS = [
    { label: t("nav.home", "Home"), href: "#home" },
    { label: t("nav.about", "About"), href: "#about" },
    { label: t("nav.experiences", "Experiences"), href: "#experiences" },
    { label: t("nav.gallery", "Gallery"), href: "#gallery" },
    { label: t("nav.pricing", "Pricing"), href: "#popular-options" },
    { label: t("nav.contact", "Contact"), href: "#contact" },
  ];

  useEffect(() => {
    lastScrollY.current = window.scrollY;

    function handleScroll() {
      const currentScrollY = window.scrollY;
      const scrolledDown = currentScrollY > lastScrollY.current;
      const pastThreshold = currentScrollY > 120;

      setIsAtTop(currentScrollY < 48);
      setIsHidden(scrolledDown && pastThreshold);
      lastScrollY.current = currentScrollY;
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (isMenuOpen) {
      setIsLanguageOpen(false);
    }
  }, [isMenuOpen]);

  useEffect(() => {
    if (isLanguageOpen && typeof window !== "undefined" && window.innerWidth >= 1024) {
      setIsMenuOpen(false);
    }
  }, [isLanguageOpen]);

  useEffect(() => {
    const shouldLockScroll = isMenuOpen || isLanguageOpen;
    document.body.style.overflow = shouldLockScroll ? "hidden" : "";
    document.body.style.touchAction = shouldLockScroll ? "none" : "";
    document.body.style.position = shouldLockScroll ? "relative" : "";

    return () => {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
      document.body.style.position = "";
    };
  }, [isMenuOpen, isLanguageOpen]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;

      if (isMenuOpen && menuPanelRef.current && !menuPanelRef.current.contains(target) && !menuButtonRef.current?.contains(target)) {
        setIsMenuOpen(false);
      }

      if (isLanguageOpen && languagePanelRef.current && !languagePanelRef.current.contains(target)) {
        setIsLanguageOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        setIsLanguageOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen, isLanguageOpen]);

  // Keep the header visible whenever the mobile menu is open, and always visible near the top.
  const hideHeader = isHidden && !isMenuOpen && !isAtTop;
  const transparentMode = isAtTop && !isMenuOpen;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        hideHeader ? "-translate-y-full" : "translate-y-0"
      } ${
        transparentMode
          ? "bg-transparent"
          : "bg-[#f6f2ea]/90 shadow-[0_8px_24px_rgba(20,37,29,0.08)] backdrop-blur-xl"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
        <Link
          href="/"
          className="flex items-center transition-transform duration-200 active:scale-[0.98] sm:hover:scale-[1.02]"
          onClick={() => setIsMenuOpen(false)}
          aria-label="Go to homepage"
        >
          <div className="select-none leading-none">
            <p
              className={`text-[15px] font-black uppercase tracking-[0.28em] transition-all duration-300 sm:text-[18px] ${
                transparentMode ? "text-white" : "text-[#14251d]"
              }`}
              style={{ letterSpacing: "0.24em" }}
            >
              Buyuk
            </p>
            <div
              className={`mt-1 h-px w-full origin-left transition-all duration-300 ${
                transparentMode ? "bg-white/35" : "bg-[#19352a]/30"
              }`}
            />
            <p
              className={`pt-1 text-[11px] font-semibold uppercase tracking-[0.5em] transition-all duration-300 sm:text-[12px] ${
                transparentMode ? "text-white/80" : "text-[#19352a]"
              }`}
              style={{ letterSpacing: "0.46em" }}
            >
              Chamlija
            </p>
          </div>
        </Link>

        <nav
          className={`hidden items-center gap-8 text-[11px] font-medium uppercase tracking-[0.18em] transition-colors duration-500 lg:flex ${
            transparentMode ? "text-white/80" : "text-[#14251d]/80"
          }`}
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`relative pb-1 transition hover:opacity-100 ${
                transparentMode ? "hover:text-white" : "hover:text-[#19352a]"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsLanguageOpen((open) => !open)}
              className={`hidden h-10 w-10 items-center justify-center rounded-full border transition lg:inline-flex ${
                transparentMode ? "border-white/25 text-white hover:bg-white/10" : "border-[#14251d]/15 text-[#14251d] hover:bg-[#f6f2ea]"
              }`}
              aria-label="Language selector"
            >
              <GlobeIcon className="h-5 w-5" />
            </button>

            {isLanguageOpen && (
              <div className="fixed inset-0 z-[60] hidden items-end justify-center bg-[#14251d]/35 p-3 backdrop-blur-[2px] sm:items-center lg:flex" onClick={() => setIsLanguageOpen(false)}>
                <div
                  ref={languagePanelRef}
                  className="w-full max-w-[390px] overflow-hidden rounded-[1.5rem] border border-[#dfe8df] bg-[#f8f6f1] shadow-[0_24px_60px_rgba(20,37,29,0.18)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-[#dfe8df] px-4 py-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7a8462]">Language</p>
                      <p className="mt-1 text-sm font-semibold text-[#14251d]">Choose your language</p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#dfe8df] bg-white text-[#14251d] transition hover:bg-[#edf6ee]"
                      onClick={() => setIsLanguageOpen(false)}
                      aria-label="Close language selector"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-3">
                    {LANGUAGES.map((item) => (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => {
                          setLanguage(item.code as LanguageCode);
                          setIsLanguageOpen(false);
                        }}
                        className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-3 text-left text-sm transition active:scale-[0.99] ${
                          language === item.code
                            ? "border-[#cfe8d6] bg-[#edf6ee] text-[#14251d] shadow-sm"
                            : "border-[#e4e7df] bg-white text-[#3d4d45] hover:bg-[#f3f7f4]"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-base">{item.flag}</span>
                          <span className="font-medium">{item.label}</span>
                        </span>
                        {language === item.code && <span className="text-xs font-bold text-[#19352a]">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <Link
            href="/book"
            className="hidden items-center justify-center rounded-full bg-[#e8e1d4] px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#14251d] shadow-[0_8px_18px_rgba(20,37,29,0.12)] transition hover:bg-white sm:inline-flex"
          >
            {t("nav.reservation", "Book Now")}
          </Link>

          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMenuOpen}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors duration-500 lg:hidden ${
              transparentMode && !isMenuOpen
                ? "border-white/50 bg-white/10 text-white"
                : "border-[#19352a]/15 bg-white text-[#14251d]"
            }`}
          >
            <span className="sr-only">Toggle navigation</span>
            {isMenuOpen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className={`fixed inset-0 z-[70] transition-all duration-300 lg:hidden ${isMenuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>
        <button
          type="button"
          aria-label="Close mobile navigation"
          onClick={() => setIsMenuOpen(false)}
          className="absolute inset-0 bg-[#14251d]/40 backdrop-blur-[2px]"
        />

        <div
          ref={menuPanelRef}
          className={`fixed inset-0 z-[71] flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-y-auto bg-[#132a23] shadow-[0_25px_60px_rgba(20,37,29,0.28)] transition-all duration-300 ${
            isMenuOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
          }`}
        >
          <div className="flex-shrink-0 border-b border-white/10 px-5 pb-4 pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#d7d9c6]">Menu</p>
                <p className="mt-2 text-lg font-semibold text-white">Chamlija</p>
              </div>
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                aria-label="Close menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5">
            <div className="space-y-5 pb-8">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d7d9c6]">Navigation</p>
                <nav className="mt-3 flex flex-col gap-1">
                  {NAV_LINKS.map((link, index) => (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={() => setIsMenuOpen(false)}
                      style={{ transitionDelay: isMenuOpen ? `${index * 40}ms` : "0ms" }}
                      className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-base font-medium text-white/90 transition hover:bg-white/6"
                    >
                      {link.label}
                    </a>
                  ))}
                </nav>
              </div>

              <Link
                href="/book"
                onClick={() => setIsMenuOpen(false)}
                className="flex items-center justify-center rounded-full bg-[#dca77d] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#14251d] shadow-lg shadow-[#dca77d]/30"
              >
                {t("nav.reservation", "Book Now")}
              </Link>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d7d9c6]">Contact</p>
                <div className="mt-3 space-y-2">
                  {contactItems.map((item) => (
                    <a
                      key={item.label}
                      href={item.href}
                      target={item.href.startsWith("http") ? "_blank" : undefined}
                      rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      onClick={() => setIsMenuOpen(false)}
                      className="flex items-start justify-between gap-3 rounded-2xl border border-white/8 bg-white/3 px-3 py-2.5 text-sm text-white/80"
                    >
                      <span className="font-medium text-[#d7d9c6]">{item.label}</span>
                      <span className="text-right text-white/90">{item.value}</span>
                    </a>
                  ))}
                </div>
              </div>

              <div className="lg:hidden">
                <button
                  type="button"
                  onClick={() => setIsLanguageOpen((open) => !open)}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm text-white/90"
                >
                  <span className="font-medium text-[#d7d9c6]">Language</span>
                  <span className="flex items-center gap-2">
                    <span>{getLanguageMeta(language).flag}</span>
                    <span>{getLanguageMeta(language).label}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-white/70">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m7 10 5 5 5-5" />
                    </svg>
                  </span>
                </button>

                {isLanguageOpen && (
                  <div
                    ref={languagePanelRef}
                    className="mt-3 overflow-hidden rounded-[1.5rem] border border-[#dfe8df] bg-[#f8f6f1] shadow-[0_20px_40px_rgba(20,37,29,0.12)]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex items-center justify-between border-b border-[#dfe8df] px-4 py-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7a8462]">Language</p>
                        <p className="mt-1 text-sm font-semibold text-[#14251d]">Choose your language</p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#dfe8df] bg-white text-[#14251d] transition hover:bg-[#edf6ee]"
                        onClick={() => setIsLanguageOpen(false)}
                        aria-label="Close language selector"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <div className="max-h-48 overflow-y-auto p-3">
                      <div className="grid grid-cols-2 gap-2">
                        {LANGUAGES.map((item) => (
                          <button
                            key={item.code}
                            type="button"
                            onClick={() => {
                              setLanguage(item.code as LanguageCode);
                              setIsLanguageOpen(false);
                              setIsMenuOpen(false);
                            }}
                            className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-3 text-left text-sm transition active:scale-[0.99] ${
                              language === item.code
                                ? "border-[#cfe8d6] bg-[#edf6ee] text-[#14251d] shadow-sm"
                                : "border-[#e4e7df] bg-white text-[#3d4d45] hover:bg-[#f3f7f4]"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="text-base">{item.flag}</span>
                              <span className="font-medium">{item.label}</span>
                            </span>
                            {language === item.code && <span className="text-xs font-bold text-[#19352a]">✓</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLanguageOpen && !isMenuOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#14251d]/45 p-3 backdrop-blur-[2px] sm:items-center" onClick={() => setIsLanguageOpen(false)}>
          <div
            ref={languagePanelRef}
            className="w-full max-w-[390px] overflow-hidden rounded-[1.5rem] border border-[#dfe8df] bg-[#f8f6f1] shadow-[0_24px_60px_rgba(20,37,29,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#dfe8df] px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7a8462]">Language</p>
                <p className="mt-1 text-sm font-semibold text-[#14251d]">Choose your language</p>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#dfe8df] bg-white text-[#14251d] transition hover:bg-[#edf6ee]"
                onClick={() => setIsLanguageOpen(false)}
                aria-label="Close language selector"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3">
              {LANGUAGES.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    setLanguage(item.code as LanguageCode);
                    setIsLanguageOpen(false);
                    setIsMenuOpen(false);
                  }}
                  className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-3 text-left text-sm transition active:scale-[0.99] ${
                    language === item.code
                      ? "border-[#cfe8d6] bg-[#edf6ee] text-[#14251d] shadow-sm"
                      : "border-[#e4e7df] bg-white text-[#3d4d45] hover:bg-[#f3f7f4]"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base">{item.flag}</span>
                    <span className="font-medium">{item.label}</span>
                  </span>
                  {language === item.code && <span className="text-xs font-bold text-[#19352a]">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
