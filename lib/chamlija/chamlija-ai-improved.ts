/**
 * IMPROVED CHAMLIJA AI SYSTEM
 *
 * Dynamic, intent-based chatbot with playful but practical day planning.
 */

import { formatCurrency } from "@/lib/booking/pricing";
import {
  VERIFIED_CHAMLIJA_FACTS,
  getVerifiedActivityExamples,
  getVerifiedActivityList,
  getVerifiedNoDataResponse,
} from "@/lib/chamlija/verified-facts";

const BOOKING_ROUTE = "/book";

export type ChatResponseType =
  | "text"
  | "section"
  | "pricing"
  | "activities"
  | "family-recommendation"
  | "itinerary"
  | "general-info";

export type ChatResponseSection = {
  emoji?: string;
  title?: string;
  content: string | string[] | { label: string; value: string }[];
  subtitle?: string;
};

export type TimelineItem = {
  time: string;
  title: string;
  description: string;
  price?: string;
  note?: string;
  badge?: string;
};

export type ChatResponse = {
  type: ChatResponseType;
  sections: ChatResponseSection[];
  timeline?: TimelineItem[];
  cta?: { label: string; action: "reservation" | "location" | "instagram"; href?: string };
  planner?: { mode: "plan-my-day" };
};

export type VisitorProfile = {
  groupType: "family" | "couple" | "friends" | "solo" | "group" | "unknown";
  adults?: number;
  children?: number;
  stayHours?: number;
  wantsRelaxing?: boolean;
  wantsActive?: boolean;
  wantsAnimals?: boolean;
  wantsSports?: boolean;
  wantsPicnic?: boolean;
  wantsPaid?: boolean;
  budgetFriendly?: boolean;
  arrivalTime?: "morning" | "afternoon";
  language?: "en" | "tr" | "af" | "zu" | "xh";
};

const normalize = (value: string) => {
  let normalized = value
    .replace(/İ/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .trim();

  normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized;
};

const containsAny = (text: string, values: string[]) =>
  values.some((value) => text.includes(value));

const randomFrom = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

const isTurkishInput = (text: string) => /[çğıöşü]/.test(text) || /aile|cocuk|çocuk|gün|gun|saat|piknik|rezervasyon|rezerv|fiyat|ne kadar|merhaba|nasılsın|nasilsin|pazar|cumartesi|pazartesi|bisiklet|basketbol|hayvan|yetişkin|yetiskin|ekipman|doğum|dogum|ox wagon|mini golf/.test(text);

const parseNumbers = (text: string): number[] => {
  const matches = text.match(/\d+/g) ?? [];
  return matches.map((value) => Number(value));
};

const parseSchoolGroupCounts = (text: string) => {
  const normalized = normalize(text);
  const numbers = parseNumbers(normalized);

  const adultMatches = normalized.match(/(\d+)\s*(teacher|teachers|adult|adults|yetiskin|yetişkin|ogretmen|öğretmen|person|people|kisiler|kisi|adults?)/g) ?? [];
  const childMatches = normalized.match(/(\d+)\s*(child|children|kid|kids|student|students|cocuk|çocuk|ogrenci|öğrenci|kids?)/g) ?? [];

  const adults = adultMatches.length > 0
    ? adultMatches.reduce((sum, match) => {
        const value = Number(match.match(/\d+/)?.[0] ?? 0);
        return sum + value;
      }, 0)
    : numbers[0] && normalized.includes("teacher") || normalized.includes("ogretmen") || normalized.includes("öğretmen") || normalized.includes("adult") || normalized.includes("yetiskin") || normalized.includes("yetişkin")
      ? numbers[0]
      : undefined;

  const children = childMatches.length > 0
    ? childMatches.reduce((sum, match) => {
        const value = Number(match.match(/\d+/)?.[0] ?? 0);
        return sum + value;
      }, 0)
    : numbers[1] && normalized.includes("child") || normalized.includes("cocuk") || normalized.includes("çocuk") || normalized.includes("student") || normalized.includes("ogrenci") || normalized.includes("öğrenci") || normalized.includes("kid")
      ? numbers[1]
      : undefined;

  const totalPeople = numbers[0] ?? 0;
  const fallbackAdults = adults ?? Math.max(1, Math.round(totalPeople * 0.12));
  const fallbackChildren = children ?? Math.max(0, totalPeople - fallbackAdults);

  return {
    adults: adults ?? fallbackAdults,
    children: children ?? fallbackChildren,
    total: adults && children ? adults + children : totalPeople || fallbackAdults + fallbackChildren,
  };
};

const getLanguage = (text: string): "en" | "tr" | "af" | "zu" | "xh" => {
  const normalized = normalize(text);
  // Detect language from keywords
  if (isTurkishInput(normalized)) return "tr";
  if (normalized.includes("afrikaans") || normalized.includes("hallo") || normalized.includes("goeie")) return "af";
  if (normalized.includes("zulu") || normalized.includes("sawubona") || normalized.includes("ngubani")) return "zu";
  if (normalized.includes("xhosa") || normalized.includes("molo") || normalized.includes("unjani")) return "xh";
  return "en";
};

const getEquipmentNote = (title: string): string | undefined => {
  if (title.toLowerCase().includes("bike")) return "(Bring your own bicycle)";
  if (["basketball", "cricket", "beach volleyball", "mini golf"].some((item) => title.toLowerCase().includes(item))) {
    return "(Bring your own equipment)";
  }
  return undefined;
};

export type UserIntent =
  | "greeting"
  | "how-are-you"
  | "activities"
  | "family-recommendation"
  | "pricing-general"
  | "pricing-specific"
  | "pricing-by-item"
  | "opening-hours"
  | "location"
  | "reservation"
  | "plan-day"
  | "animals"
  | "rules"
  | "own-furniture"
  | "group-quote"
  | "facility-check"
  | "availability-check"
  | "unknown";

const detectReservationArea = (text: string): string | null => {
  const normalized = normalize(text);
  const areaMap: Array<[string[], string]> = [
    [["braai area", "braai", "barbeque area", "bbq area"], "Braai Area"],
    [["ottoman corner", "ottoman"], "Ottoman Corner"],
    [["grass area", "grass"], "Grass Area"],
    [["picnic area", "picnic"], "Picnic Area"],
  ];

  for (const [keys, label] of areaMap) {
    if (keys.some((key) => normalized.includes(key))) return label;
  }

  return null;
};

const detectOwnFurnitureQuestion = (text: string): boolean => {
  const normalized = normalize(text);
  const compact = normalized.replace(/[^a-z0-9]/g, "");

  const ownTerms = [
    "own",
    "my own",
    "kendi",
    "benim kendi",
    "kendimink",
    "bring my own",
    "bring own",
    "getir",
    "getirebilir",
    "getirebilirim",
    "bring",
    "carry",
    "briing",
    "brng",
  ];

  const furnitureTerms = [
    "table",
    "chair",
    "tables",
    "chairs",
    "furniture",
    "masa",
    "sandalye",
    "masalar",
    "sandalyeler",
    "mobilya",
    "masa ve sandalye",
    "sandalyemi",
    "masami",
    "sandalyegetir",
    "masagetir",
    "masasandalye",
    "tabel",
    "sandalye",
    "sndlye",
    "sndly",
    "masaa",
  ];

  const hasOwnSignal = ownTerms.some((term) => normalized.includes(term) || compact.includes(term.replace(/\s+/g, "")));
  const hasFurnitureSignal = furnitureTerms.some((term) => normalized.includes(term) || compact.includes(term.replace(/\s+/g, "")));

  const hasCombination =
    (normalized.includes("own") && (normalized.includes("table") || normalized.includes("chair") || normalized.includes("furniture") || normalized.includes("masa") || normalized.includes("sandalye"))) ||
    (normalized.includes("kendi") && (normalized.includes("masa") || normalized.includes("sandalye") || normalized.includes("mobilya"))) ||
    (normalized.includes("masa") && (normalized.includes("sandalye") || normalized.includes("getire") || normalized.includes("getir"))) ||
    (normalized.includes("sandalye") && (normalized.includes("masa") || normalized.includes("getire") || normalized.includes("getir"))) ||
    (compact.includes("myowntable") || compact.includes("myownchair") || compact.includes("owntable") || compact.includes("ownchair") || compact.includes("ownfurniture") || compact.includes("kendimasa") || compact.includes("kendisandalye") || compact.includes("masasandalye") || compact.includes("masavesandalye") || compact.includes("sandalyegetir") || compact.includes("masagetir"));

  return hasOwnSignal && hasFurnitureSignal || hasCombination;
};

const generateOwnFurnitureResponse = (input: string): ChatResponse => {
  const language = getLanguage(input);

  const answers: Record<typeof language, { title: string; content: string }> = {
    en: {
      title: "✅ Yes",
      content: "Yes — you can bring your own table and chairs, as long as they fit the area and follow the site rules. If you want, I can help you plan the best setup for your booking.",
    },
    tr: {
      title: "✅ Evet",
      content: "Evet — kendi masa ve sandalyenizi getirebilirsiniz. Sadece alanın uygun olmasına ve Chamlija kurallarına uymasına dikkat etmeniz yeterlidir. İsterseniz rezervasyon için en uygun düzeni birlikte planlayabilirim.",
    },
    af: {
      title: "✅ Ja",
      content: "Ja — jy kan jou eie tafel en stoele bring, solank dit by die area pas en die reëls volg. As jy wil, kan ek jou help om die beste opset vir jou bespreking te beplan.",
    },
    zu: {
      title: "✅ Yebo",
      content: "Yebo — ungakwazi ukuza neta itafula lakho neziphini zakho, uma zihlangana nendawo futhi zilandela imithetho yesiza. Uma ufuna, ngingakusiza ukuhlela isakhiwo esifanele sokubhukha.",
    },
    xh: {
      title: "✅ Ewe",
      content: "Ewe — ungazisa itafile yakho neentyana zakho, njengoko zifanelekile kwindawo kwaye zilandela umthetho welizwe. Ukuba ufuna, ndingakunceda ukulungiselela isakhiwo esifanelekileyo sokubhukha.",
    },
  };

  const chosen = answers[language] ?? answers.en;

  return {
    type: "text",
    sections: [{ emoji: "✅", title: chosen.title, content: [chosen.content] }],
  };
};

const buildReservationHref = (input: string): string => {
  const params = new URLSearchParams();
  const area = detectReservationArea(input);
  const numbers = parseNumbers(normalize(input));
  const adults = numbers[0] ?? 1;
  const children = numbers[1] ?? 0;

  if (area) params.set("area", area);
  if (numbers.length > 0) {
    params.set("adults", String(adults));
    if (numbers.length > 1) params.set("children3Plus", String(children));
  }

  const ticketDate = input.match(/(next weekend|weekend|saturday|sunday|tomorrow|monday|tuesday|wednesday|thursday|friday)/i);
  if (ticketDate) {
    params.set("dateHint", ticketDate[0]);
  }

  const search = params.toString();
  return search ? `${BOOKING_ROUTE}?${search}` : BOOKING_ROUTE;
};

export function detectIntent(input: string): UserIntent {
  const normalized = normalize(input);

  const wantsQuote = containsAny(normalized, [
    "fiyat teklifi", "fiyat teklif", "quote", "pricing quote", "price quote", "teklif alabilir miyiz", "quotation", "quote request",
    "fiyat vermenizi", "price estimate", "estimate cost", "price estimate", "cost estimate", "offer",
    "anaokulu", "okul", "school", "group visit", "school trip", "class trip", "teachers", "öğretmen", "ogretmen",
    "kac para", "ne kadar tutar", "what is the total", "total cost", "group price"
  ]);

  if (wantsQuote && (containsAny(normalized, ["teacher", "teachers", "ogretmen", "öğretmen", "child", "children", "cocuk", "çocuk", "student", "students", "ogrenci", "öğrenci", "school", "anaokulu", "okul"]) || parseNumbers(normalized).length > 0)) {
    return "group-quote";
  }

  if (containsAny(normalized, ["merhaba", "selam", "hello", "hi", "hey", "good morning", "iyi gunler", "iyi aksamlar", "good day", "good evening"])) {
    return "greeting";
  }

  if (containsAny(normalized, ["otopark", "parking", "car park", "free parking", "mangal", "braai", "barbeque", "bbq", "balik", "fishing", "at binisi", "horse riding", "yemek", "food", "restaurant", "coffee", "cay", "tea", "dondurma", "pankek", "popcorn", "hamburger", "country bazaar", "karinja", "delibite", "amphitheater", "amfitiyatro", "yellow wood", "play park", "oyun alanı", "namaz", "prayer", "ibadet", "salah", "shalat", "tuvalet", "toilet", "wc", "restroom", "helal", "halal", "kosher", "halaal"])) {
    return "facility-check";
  }

  if (containsAny(normalized, ["nasilsin", "how are you", "how are things", "nasil gidiyor"])) {
    return "how-are-you";
  }

  if (containsAny(normalized, ["aktivite", "activity", "activities", "ne yapabiliriz", "fun", "what can we do", "neler yapabiliriz", "oyun", "game", "sports"])) {
    return "activities";
  }

  if (containsAny(normalized, ["aile", "family", "cocuk", "children", "kids", "onerisi", "recommendation", "uygun", "suitable", "ailemle", "with kids", "family day"])) {
    return "family-recommendation";
  }

  if (containsAny(normalized, ["acik", "open", "closed", "kapalı", "working hours", "saatleri", "pazartesi", "monday", "saat", "hour", "time"])) {
    return "opening-hours";
  }

  if (containsAny(normalized, ["konum", "location", "nerede", "adres", "harita", "maps", "where"])) {
    return "location";
  }

  if (containsAny(normalized, ["rezerv", "booking", "book", "reserve", "randevu", "ayir", "rezervasyon", "make a reservation", "book a picnic area", "reserve the braai", "reserve the grass", "reserve the picnic", "reserve area"])) {
    return "reservation";
  }

  if (containsAny(normalized, ["plan my day", "plan my visit", "itinerary", "gunu plan", "day plan", "gun boyunca", "full day", "programi", "schedule", "my day"])) {
    return "plan-day";
  }

  if (containsAny(normalized, ["fiyat", "price", "ucret", "fee", "maliyet", "cost", "kaç", "how much", "ne kadar", "all prices", "tum fiyatlar"]) && !containsAny(normalized, ["braai", "ottoman", "grass", "tent", "cart", "wagon", "amphitheater", "barn", "table", "chair", "feed", "shoot"])) {
    return "pricing-general";
  }

  if (containsAny(normalized, ["braai", "ottoman", "grass", "tent", "cart", "wagon", "amphitheater", "barn", "table", "chair", "feed", "shoot", "picnic", "fiyat", "price"])) {
    return "pricing-specific";
  }

  if (containsAny(normalized, ["hayvan", "animal", "zoo", "camel", "rabbit", "duck", "llama", "donkey", "gorulecek", "viewing", "besle", "feed"])) {
    return "animals";
  }

  if (containsAny(normalized, ["alkol", "alcohol", "muzik", "music", "rule", "kural", "yasak", "allowed"])) {
    return "rules";
  }

  if (detectOwnFurnitureQuestion(normalized)) {
    return "own-furniture";
  }

  if (containsAny(normalized, ["available", "mevcut", "bos", "boş", "uygun", "tarih", "date", "dolu", "reserved", "reserved dates", "available dates", "hangi gunler", "hangi günler", "when can we come", "ne zaman gelebiliriz", "available day", "free day", "ne zaman mevcut"])) {
    return "availability-check";
  }

  return "unknown";
}

export function detectVisitorProfile(input: string): VisitorProfile {
  const normalized = normalize(input);
  const numbers = parseNumbers(normalized);

  const adults = numbers[0] ?? undefined;
  const children = numbers[1] ?? undefined;

  const hasFamily = containsAny(normalized, ["family", "aile", "with kids", "cocuk", "children", "kids"]);
  const hasCouple = containsAny(normalized, ["couple", "two people", "lovely day for two", "cift", "iki kisi", "çift"]);
  const hasFriends = containsAny(normalized, ["friends", "friend", "arkadas", "group of friends", "dostlar", "grup"]);
  const hasSolo = containsAny(normalized, ["solo", "just me", "alone", "tek basina", "yalniz", "just me"]);

  const groupType: VisitorProfile["groupType"] =
    hasFamily ? "family" :
    hasCouple ? "couple" :
    hasFriends ? "friends" :
    hasSolo ? "solo" :
    containsAny(normalized, ["group", "event", "party", "grup", "etkinlik"]) ? "group" :
    "unknown";

  const stayHours = (() => {
    const durationWords = [
      ["3 hours", "3 saat", "3hr"],
      ["4 hours", "4 saat"],
      ["5 hours", "5 saat"],
      ["6 hours", "6 saat"],
      ["all day", "whole day", "tum gun", "bütün gün"],
    ];

    for (const [english, turkish] of durationWords) {
      if (containsAny(normalized, english.split(" ")) || containsAny(normalized, turkish.split(" "))) {
        return english.includes("all day") || turkish.includes("gun") ? 8 : Number(english.match(/\d+/)?.[0] ?? 6);
      }
    }

    return undefined;
  })();

  return {
    groupType,
    adults: adults && adults > 0 ? adults : undefined,
    children: children && children >= 0 ? children : undefined,
    stayHours,
    wantsRelaxing: containsAny(normalized, ["relax", "relaxing", "rest", "calm", "dinlenmek", "sessiz", "peaceful"]) || containsAny(normalized, ["love", "comfortable", "slow day"]),
    wantsActive: containsAny(normalized, ["active", "sport", "sports", "energetic", "busy", "aktif", "spor", "oyun"]),
    wantsAnimals: containsAny(normalized, ["animals", "hayvan", "animal viewing", "zoo", "hayvanlar"]),
    wantsSports: containsAny(normalized, ["sports", "basketball", "cricket", "volleyball", "mini golf", "bike", "spor", "basketbol", "kriket", "voleybol"]),
    wantsPicnic: containsAny(normalized, ["picnic", "piknik", "braai", "barbeque", "bbq"]),
    wantsPaid: containsAny(normalized, ["paid", "feed", "animal feeding", "ox wagon", "premium", "odeme", "ucretli", "besleme", "wagon"]),
    budgetFriendly: containsAny(normalized, ["budget", "cheap", "affordable", "low cost", "bütçe", "ucuz", "düşük maliyet"]),
    arrivalTime: containsAny(normalized, ["afternoon", "after lunch", "öğleden sonra", "pm"]) ? "afternoon" : "morning",
    language: getLanguage(input),
  };
}

const languageLabel = (language: string, en: string, tr: string, af?: string, zu?: string, xh?: string): string => {
  if (language === "tr") return tr;
  if (language === "af") return af || en;
  if (language === "zu") return zu || en;
  if (language === "xh") return xh || en;
  return en;
};

const t = {
  intro: {
    en: {
      family: "Perfect! 🌿 Since you’re visiting with children, I’ve built a relaxed family-friendly day with animals, play time and a few easy activities.",
      couple: "Sounds like a lovely day for two ❤️ I’ve mixed some relaxing nature time with a few enjoyable activities.",
      friends: "Great! 👥 I’ve put together a more active day with sports, cycling and a little downtime to keep it balanced.",
      solo: "Perfect! 🧍 I’ve created a personal Chamlija day with a good mix of nature, activity and downtime.",
      group: "Wonderful! 🎉 I’ve designed a bigger, more social day with a mix of shared activities and free time.",
      unknown: "Absolutely! 🌿 I can create a personalized Chamlija day for you."
    },
    tr: {
      family: "Harika! 🌿 Çocuklarla geldiğin için daha sakin, aile dostu bir gün hazırladım; hayvanlar, oyun alanı ve keyifli aktivitelerle.",
      couple: "Kulağa romantik bir gün gibi geliyor ❤️ Doğa keyfi ile birkaç eğlenceli aktiviteyi bir araya getirdim.",
      friends: "Müthiş! 👥 Daha hareketli, spor odaklı ve biraz dinlenme alanı olan bir gün hazırladım.",
      solo: "Harika! 🧍 Kendi ritminize uygun, doğa, aktivite ve dinlenme karışımı bir Chamlija günü hazırladım.",
      group: "Muhteşem! 🎉 Daha sosyal ve enerjik, birlikte yapılan aktivitelerle dolu bir gün planladım.",
      unknown: "Tabii! 🌿 Sana özel bir Chamlija günü hazırlayabilirim."
    },
    af: {
      family: "Perfek! 🌿 Ek het 'n ontspannende dag gemaak vir jou.",
      couple: "Pragtig! ❤️ Ek het iets moois gemaak.",
      friends: "Groot! 👥 Ek het 'n aktiewe dag gemaak.",
      solo: "Perfek! 🧍 Jy gaan dit geniet.",
      group: "Wonderlik! 🎉 'n Groot dag wag op jou.",
      unknown: "Absoluut! 🌿 Ek kan 'n dag vir jou maak."
    },
    zu: {
      family: "Kuphelele! 🌿 Ngwenenze usuku oluthule.",
      couple: "Kuhle! ❤️ Ngwenenze usuku olukhangela.",
      friends: "Inkosikazi! 👥 Ngwenenze usuku olukhuluma.",
      solo: "Kuphelele! 🧍 Uzokuthanda.",
      group: "Kuhle! 🎉 Usuku olukhulu lulindele.",
      unknown: "Impela! 🌿 Ngingakwenza usuku."
    },
    xh: {
      family: "Eyalungile! 🌿 Ndenze usuku olukhululekile.",
      couple: "Kuhle! ❤️ Ndenze usuku elumnandi.",
      friends: "Enkosikazi! 👥 Ndenze usuku elikhuluma.",
      solo: "Eyalungile! 🧍 Uzakukuthanda.",
      group: "Kuhle! 🎉 Usuku olukhulu lulindele.",
      unknown: "Impela! 🌿 Ndingakwenza usuku."
    }
  },
  ask: {
    en: [
      "Absolutely! 🌿 I can create a personalized Chamlija day for you.",
      "Who are you visiting with?",
      "👨‍👩‍👧 Family",
      "❤️ Couple",
      "👥 Friends",
      "🧍 Just me"
    ],
    tr: [
      "Tabii! 🌿 Sana özel bir Chamlija günü hazırlayabilirim.",
      "Kiminle geliyorsun?",
      "👨‍👩‍👧 Aile",
      "❤️ Çift",
      "👥 Arkadaşlar",
      "🧍 Yalnız"
    ]
  }
};

const freeActivities = {
  en: [
    { title: "Animal Viewing", description: "Explore the animals around Chamlija.", price: "FREE" },
    { title: "Yellow Wood Play Park", description: "A great stop for children and active family fun.", price: "FREE" },
    { title: "Bike Riding", description: "Enjoy a ride through the park.", price: "FREE", note: "(Bring your own bicycle)" },
    { title: "Basketball", description: "Open play and a fun active break.", price: "FREE", note: "(Bring your own equipment)" },
    { title: "Cricket", description: "A relaxed sports option for groups.", price: "FREE", note: "(Bring your own equipment)" },
    { title: "Beach Volleyball", description: "A fun outdoor game with a social feel.", price: "FREE", note: "(Bring your own equipment)" },
    { title: "Mini Golf", description: "A casual activity and a nice break from the heat.", price: "FREE", note: "(Bring your own equipment)" },
    { title: "Jumping Castle", description: "Fun for children with energy to burn.", price: "FREE" },
    { title: "Nature & Open Areas", description: "Walk, enjoy the landscape and take it easy.", price: "FREE" }
  ],
  tr: [
    { title: "Hayvan İzleme", description: "Chamlija'daki hayvanları keşfedin.", price: "ÜCRETSİZ" },
    { title: "Yellow Wood Play Park", description: "Çocuklar için harika bir oyun alanı.", price: "ÜCRETSİZ" },
    { title: "Bisiklet Sürme", description: "Park içinde keyifli bir tur atın.", price: "ÜCRETSİZ", note: "(Kendi bisikletinizi getirin)" },
    { title: "Basketbol", description: "Enerjik bir mola için uygun bir seçenek.", price: "ÜCRETSİZ", note: "(Kendi ekipmanınızı getirin)" },
    { title: "Kriket", description: "Grup için sakin, sportif bir aktivite.", price: "ÜCRETSİZ", note: "(Kendi ekipmanınızı getirin)" },
    { title: "Beach Volleyball", description: "Sosyal ve eğlenceli açık hava oyunu.", price: "ÜCRETSİZ", note: "(Kendi ekipmanınızı getirin)" },
    { title: "Mini Golf", description: "Güne hafif ve keyifli bir aktivite ekler.", price: "ÜCRETSİZ", note: "(Kendi ekipmanınızı getirin)" },
    { title: "Jumping Castle", description: "Enerjisi yüksek çocuklar için ideal.", price: "ÜCRETSİZ" },
    { title: "Doğa & Açık Alanlar", description: "Yürüyüş yapın, doğayı izleyin ve sakinleşin.", price: "ÜCRETSİZ" }
  ],
  af: [
    { title: "Dierekyking", description: "Verken die diere rondom Chamlija.", price: "GRATIS" },
    { title: "Yellow Wood Speel Park", description: "'n Groot stop vir kinders en aktiewe gesinsplasier.", price: "GRATIS" },
    { title: "Sitplankry", description: "Geniet 'n rit deur die park.", price: "GRATIS", note: "(Bring jou eie fiets)" },
    { title: "Basketbal", description: "Oop spel en 'n lekker aktiewe pouse.", price: "GRATIS", note: "(Bring jou eie toerusting)" },
    { title: "Krieket", description: "'n Ontspannende sportopsie vir groepe.", price: "GRATIS", note: "(Bring jou eie toerusting)" },
    { title: "Strandvolleybal", description: "'n Lekker buitespel met 'n sosiale gevoel.", price: "GRATIS", note: "(Bring jou eie toerusting)" },
    { title: "Miniature Golf", description: "'n Toevallige aktiwiteit en 'n lekker pouse van die hitte.", price: "GRATIS", note: "(Bring jou eie toerusting)" },
    { title: "Springkasteel", description: "Lekker vir kinders met energie.", price: "GRATIS" },
    { title: "Natuur & Oop Gebiede", description: "Stap, geniet die landskap en ontspan.", price: "GRATIS" }
  ],
  zu: [
    { title: "Ukubheka Izilwane", description: "Hlola izilwane ezinjalo kuChamlija.", price: "MAHHALA" },
    { title: "Yellow Wood Play Park", description: "Isithi esikhulu sezingane nesiselo somndeni.", price: "MAHHALA" },
    { title: "Ukusulela Ibhayisikeli", description: "Jabulani nokuya ku-ithafula eliparkini.", price: "MAHHALA", note: "(Letha ibhayisikeli yakho)" },
    { title: "Ibasekhelo", description: "Ukudlala ngokukhululekile nokuphumula.", price: "MAHHALA", note: "(Letha ukhusi wakho)" },
    { title: "Ikrikhete", description: "Inhlobo yezemidlalo enobuntu bobantu.", price: "MAHHALA", note: "(Letha ukhusi wakho)" },
    { title: "Beach Volleyball", description: "Umdlalo othanda ukwenziwa ngaphandle nomdeni.", price: "MAHHALA", note: "(Letha ukhusi wakho)" },
    { title: "Mini Golf", description: "Umsebenzi osonti futhi omuhle okuphumula.", price: "MAHHALA", note: "(Letha ukhusi wakho)" },
    { title: "Jumping Castle", description: "Okuhle ngezingane ezinesikhathi sokugaleka.", price: "MAHHALA" },
    { title: "Izikhumbuzo Zikamuntu Ne-Area", description: "Zula, ubheke indawo futhi uphumule.", price: "MAHHALA" }
  ],
  xh: [
    { title: "Ukubheka Izilwanyana", description: "Hlola izilwanyana ezinjalo kuChamlija.", price: "SIMAHLA" },
    { title: "Yellow Wood Play Park", description: "Isiqalo esixakabisayo sabantwana nesiselo soxapho.", price: "SIMAHLA" },
    { title: "Ukunyanda Sebhayisikeli", description: "Jabulani nokuya kwigaki.", price: "SIMAHLA", note: "(Letha ibhayisikeli yakho)" },
    { title: "Ibasekhelo", description: "Umdlalo ngokukhululekile nokuphumula.", price: "SIMAHLA", note: "(Letha ukhusi wakho)" },
    { title: "Ikliki", description: "Umdlalo wezindawo esisele abantu.", price: "SIMAHLA", note: "(Letha ukhusi wakho)" },
    { title: "Beach Volleyball", description: "Umdlalo othanda ukwenziwa ngaphandle nesiselo.", price: "SIMAHLA", note: "(Letha ukhusi wakho)" },
    { title: "Mini Golf", description: "Umdlalo wesesikhashana kunye nomphumela.", price: "SIMAHLA", note: "(Letha ukhusi wakho)" },
    { title: "Jumping Castle", description: "Ekuseni yentwana ezinesikhathi sokugaleka.", price: "SIMAHLA" },
    { title: "Izikhumbuzo Zezinye neZindawo", description: "Zula, ubheke inkcazo futhi uphumule.", price: "SIMAHLA" }
  ]
};

const paidActivities = {
  en: [
    { title: "Animal Feeding", description: "A great interactive stop for children and families.", price: "ZAR 30" },
    { title: "OX Wagon Tour", description: "A relaxing guided experience through the area.", price: "ZAR 60 adult / ZAR 50 child" }
  ],
  tr: [
    { title: "Hayvan Besleme", description: "Çocuklar ve aileler için interaktif bir durak.", price: "ZAR 30" },
    { title: "OX Wagon Tour", description: "Bölgeyi keyifle keşfetmenin sakin bir yolu.", price: "ZAR 60 yetişkin / ZAR 50 çocuk" }
  ],
  af: [
    { title: "Dierebesvoeding", description: "Groot interaktiewe stop vir kinders en gesinne.", price: "ZAR 30" },
    { title: "OX Wagon-toer", description: "'n Ontspannende geleide ervaring deur die gebied.", price: "ZAR 60 volwassene / ZAR 50 kind" }
  ],
  zu: [
    { title: "Ukudla Kwezilwane", description: "Isithi esikhulu se-interactive sezingane namafimelelo.", price: "ZAR 30" },
    { title: "Isiqalelo se-OX Wagon", description: "Ulwazi olukhululekile lweendawo.", price: "ZAR 60 umuntu owedlule / ZAR 50 ingane" }
  ],
  xh: [
    { title: "Ukonaka Kwisilwanyana", description: "Isithi esixakabisayo sabantwana nemafimelelo.", price: "ZAR 30" },
    { title: "Iziqalelo zeOX Wagon", description: "Ulwazi olukhululekile lweendawo.", price: "ZAR 60 umuntu owedlule / ZAR 50 ingane" }
  ]
};

// Multilingual response strings
const ML_STRINGS = {
  greeting: {
    en: { title: "Hello!", content: ["Welcome to Chamlija. I'm here to help you have an unforgettable day in our nature reserve. How can I assist?"] },
    tr: { title: "Merhaba!", content: ["Chamlija'ya hoş geldiniz. Chamlija doğa koruma alanında unutulmaz bir gün geçirmenize yardımcı olmaya hazırım. Size nasıl yardımcı olabilirim?"] },
    af: { title: "Hallo!", content: ["Welkom by Chamlija. Ek is hier om jou te help om 'n onvergeetlike dag in ons natuurreservaat deur te bring. Hoe kan ek jou help?"] },
    zu: { title: "Sawubona!", content: ["Wamukelekile kuChamlija. Ngilapha ukukusiza ukulungisa usuku olukhanyayo kulindawo yethu yemvelo. Ngiyakusiza kanjani?"] },
    xh: { title: "Molo!", content: ["Wamkelekile kwiChamlija. Ndilapha ukukunceda ukuba ulungise usuku olumnandi kwindawo yethu yemvelo. Ngandela kuthini?"] }
  },
  howAreYou: {
    en: { title: "I'm doing great, thank you!", content: ["Feel free to ask me about activities, pricing, family recommendations, and more about Chamlija!"] },
    tr: { title: "İyiyim, teşekkür ederim!", content: ["Aktiviteler, fiyatlar, aile önerileri ve Chamlija hakkında daha fazlası için bana sorabilirsiniz."] },
    af: { title: "Ek voel goed, dankie!", content: ["Voel vry om my te vra oor aktiwiteite, pryse, gesinsaanbevelings en meer oor Chamlija!"] },
    zu: { title: "Ngikhona kahle, ngiyabonga!", content: ["Zisulele ukubuza ngokomisebenzi, inanini, izeluleko zomndeni, kanye nokunye mayelana noC hamlija!"] },
    xh: { title: "Ndikhona kakuhle, enkosi!", content: ["Zisulele ukubuza malunga nendlela yokusebenza, imiganeko, iipahla zosapho, kunye nokunye malunga noChamlija!"] }
  },
  planRequest: {
    en: { content: "I can create a personalized Chamlija day for you. Who are you visiting with?" },
    tr: { content: "Sana özel bir Chamlija günü hazırlayabilirim. Kiminle geliyorsun?" },
    af: { content: "Ek kan 'n persoonlike Chamlija-dag vir jou skep. Met wie besoek jy?" },
    zu: { content: "Ngingakwenza usuku lwePersonal Chamlija. Uza kuphi nabantu?" },
    xh: { content: "Ndingakwenza usuku olwenziwe ngokukho kwakho. Uza kuphi nabantu?" }
  }
};

const buildItinerary = (profile: VisitorProfile): TimelineItem[] => {
  const language = (profile.language ?? "en") as keyof typeof freeActivities;
  const basePool = [...(freeActivities[language] || freeActivities.en), ...(paidActivities[language] || paidActivities.en)];
  let primaryPool: Array<{ title: string; description: string; price: string; note?: string }> = [...basePool];

  if (profile.groupType === "family") {
    primaryPool = [
      ...freeActivities[language].filter((item) => ["Hayvan İzleme", "Yellow Wood Play Park", "Bisiklet Sürme", "Jumping Castle", "Doğa & Açık Alanlar", "Animal Viewing", "Yellow Wood Play Park", "Bike Riding", "Jumping Castle", "Nature & Open Areas"].includes(item.title)),
      ...paidActivities[language]
    ];
  }

  if (profile.groupType === "couple") {
    primaryPool = freeActivities[language].filter((item) => ["Hayvan İzleme", "Bisiklet Sürme", "Doğa & Açık Alanlar", "Animal Viewing", "Bike Riding", "Nature & Open Areas"].includes(item.title));
    primaryPool.push(...paidActivities[language].slice(1));
  }

  if (profile.groupType === "friends") {
    primaryPool = freeActivities[language].filter((item) => ["Bisiklet Sürme", "Basketbol", "Kriket", "Beach Volleyball", "Mini Golf", "Doğa & Açık Alanlar", "Bike Riding", "Basketball", "Cricket", "Beach Volleyball", "Mini Golf", "Nature & Open Areas"].includes(item.title));
  }

  if (profile.groupType === "solo") {
    primaryPool = freeActivities[language].filter((item) => ["Hayvan İzleme", "Bisiklet Sürme", "Doğa & Açık Alanlar", "Animal Viewing", "Bike Riding", "Nature & Open Areas"].includes(item.title));
  }

  const selected = new Set<string>();
  const itinerary: TimelineItem[] = [];
  const startMinutes = profile.arrivalTime === "afternoon" ? 14 : 9;
  let currentMinute = startMinutes * 60;

  const pushSlot = (entry: { title: string; description: string; price: string; note?: string }, offset: number) => {
    if (selected.has(entry.title)) return;
    selected.add(entry.title);
    const time = new Date(0);
    time.setMinutes(currentMinute + offset);
    const hours = time.getHours().toString().padStart(2, "0");
    const minutes = time.getMinutes().toString().padStart(2, "0");

    itinerary.push({
      time: `${hours}:${minutes}`,
      title: entry.title,
      description: entry.description,
      price: entry.price,
      note: entry.note ?? getEquipmentNote(entry.title),
      badge: entry.price === "FREE" || entry.price === "ÜCRETSİZ" ? "Free" : "Paid"
    });
  };

  const arrival = {
    title: language === "tr" ? "Varış" : "Arrival",
    description: language === "tr" ? "Chamlija'ya hoş geldiniz." : "Welcome to Chamlija.",
    price: "—"
  };

  pushSlot(arrival, 0);

  const chosenActivities = [] as Array<{ title: string; description: string; price: string; note?: string }>;
  const activityCount = profile.stayHours && profile.stayHours <= 3 ? 3 : profile.stayHours && profile.stayHours >= 7 ? 6 : 4;

  for (let i = 0; i < activityCount; i += 1) {
    const candidate = randomFrom(primaryPool);
    if (!candidate) break;
    chosenActivities.push(candidate);
    primaryPool = primaryPool.filter((item) => item.title !== candidate.title);
  }

  const groupedActivities = chosenActivities.length > 0 ? chosenActivities : basePool.slice(0, 4);

  groupedActivities.forEach((entry, index) => {
    const offset = 45 + index * 70;
    pushSlot(entry, offset);
  });

  if (profile.wantsPicnic) {
    const picnic = {
      title: language === "tr" ? "Piknik" : "Picnic",
      description: language === "tr" ? "Güne dinlenerek devam edin ve öğle molası verin." : "Take a break, unwind and enjoy a picnic moment.",
      price: language === "tr" ? "İsteğe bağlı" : "Optional",
      note: language === "tr" ? "If you’d like a picnic area, you can choose from Braai Area, Ottoman Corner or Grass Area." : "If you'd like a picnic area, you can choose from Braai Area, Ottoman Corner or Grass Area."
    };
    pushSlot(picnic, 120);
  }

  const cooldown = {
    title: language === "tr" ? "Doğa keyfi / Dinlenme" : "Nature time / Relax",
    description: language === "tr" ? "Açık alanları sakin bir şekilde keşfedin." : "Take a slow walk and enjoy the natural surroundings.",
    price: "FREE",
  };

  pushSlot(cooldown, 180);

  if (profile.wantsPaid && (paidActivities[language] || paidActivities.en).length > 0) {
    const paid = randomFrom((paidActivities[language] || paidActivities.en));
    if (paid) pushSlot(paid, 240);
  }

  return itinerary.slice(0, 6);
};

const estimateCost = (profile: VisitorProfile, itinerary: TimelineItem[]) => {
  const adultCount = profile.adults ?? 2;
  const childCount = profile.children ?? 0;

  const entry = adultCount * 50 + childCount * 25;
  const paidItems = itinerary.filter((slot) => {
    const price = slot.price ?? "";
    return price.includes("ZAR 30") || price.includes("ZAR 60") || price.includes("ZAR 50");
  }).length;
  const paidFee = paidItems * 30;

  return {
    entry,
    paidFee,
    estimatedTotal: entry + paidFee
  };
};

export function generatePlanMyDayResponse(input: string = "", profileOverride?: VisitorProfile): ChatResponse {
  const profile = profileOverride ?? detectVisitorProfile(input);

  const hasVisitorInfo =
    profile.groupType !== "unknown" ||
    containsAny(normalize(input), ["family", "aile", "couple", "çift", "friends", "arkadaş", "solo", "yalnız", "just me", "2 adults", "3 kids", "2 yetişkin", "çocuk", "all day", "3 hours", "4 hours", "5 hours", "afternoon"]);

  const language = profile.language ?? getLanguage(input ?? "");

  if (!profileOverride && !hasVisitorInfo) {
    return {
      type: "text",
      sections: [
        {
          emoji: "🌿",
          title: languageLabel(language, "Absolutely! 🌿", "Tabii! 🌿"),
          content: [
            languageLabel(language, "I can create a personalized Chamlija day for you.", "Sana özel bir Chamlija günü hazırlayabilirim."),
            languageLabel(language, "Who are you visiting with?", "Kiminle geliyorsun?"),
            "👨‍👩‍👧 Family",
            "❤️ Couple",
            "👥 Friends",
            "🧍 Just me"
          ]
        }
      ]
    };
  }

  const introLang = (language as keyof typeof t.intro) || "en";
  const introGroup = (profile.groupType === "unknown" ? "unknown" : profile.groupType) as keyof typeof t.intro.en;
  const intro = t.intro[introLang]?.[introGroup] || t.intro.en[introGroup];

  const itinerary = buildItinerary({ ...profile, language });
  const cost = estimateCost(profile, itinerary);

  const sections: ChatResponseSection[] = [
    { emoji: "✨", title: language === "tr" ? "Chamlija Gün Planınız" : "Your Chamlija Day", content: [intro] },
    {
      emoji: "🧭",
      title: language === "tr" ? "Plan" : "Plan",
      content: [
        language === "tr" ? "Bu plan, ziyaret tarzınıza göre dinamik olarak oluşturuldu." : "This plan was generated dynamically based on your visit style."
      ]
    }
  ];

  if (cost.estimatedTotal > 0 && (profile.adults || profile.children)) {
    sections.push({
      emoji: "💰",
      title: language === "tr" ? "Tahmini Maliyet" : "Estimated Cost",
      content: [
        `${language === "tr" ? "Giriş" : "Entrance"}: ${profile.adults ?? 2} ${language === "tr" ? "yetişkin" : "adults"} × ZAR 50 = ZAR ${((profile.adults ?? 2) * 50)}${profile.children ? ` | ${profile.children} ${language === "tr" ? "çocuk" : "children"} × ZAR 25 = ZAR ${profile.children * 25}` : ""}`,
        `${language === "tr" ? "Tahmini toplam" : "Estimated total"}: ZAR ${cost.estimatedTotal}`
      ]
    });
  }

  return {
    type: "itinerary",
    sections,
    timeline: itinerary,
    cta: { label: language === "tr" ? "📅 Rezervasyon Yap" : "📅 Reserve Your Visit", action: "reservation" },
    planner: { mode: "plan-my-day" }
  };
}

export function generateGreetingResponse(input: string = ""): ChatResponse {
  const language = getLanguage(input) as keyof typeof ML_STRINGS.greeting;
  const strings = ML_STRINGS.greeting[language];
  
  return {
    type: "text",
    sections: [
      {
        emoji: "🌿",
        title: strings.title,
        content: strings.content
      }
    ]
  };
}

export function generateHowAreYouResponse(input: string = ""): ChatResponse {
  const language = getLanguage(input) as keyof typeof ML_STRINGS.howAreYou;
  const strings = ML_STRINGS.howAreYou[language];
  
  return {
    type: "text",
    sections: [
      {
        emoji: "😊",
        title: strings.title,
        content: strings.content
      }
    ]
  };
}

export function generateActivitiesResponse(): ChatResponse {
  return {
    type: "activities",
    sections: [
      {
        emoji: "🌿",
        title: "Verified Chamlija Activities",
        content: getVerifiedActivityList().map((activity) => {
          const [label, value] = activity.includes("(") ? activity.split(" (") : [activity, "Verified"];
          return { label: label, value: value.replace(/\)$/, "") };
        }),
      },
    ],
  };
}

export function generateFamilyRecommendationResponse(): ChatResponse {
  return {
    type: "family-recommendation",
    sections: [
      {
        emoji: "👨‍👩‍👧‍👦",
        title: "Aile İçin Öneriler",
        content: [
          "🐪 Hayvan İzleme — Ücretsiz",
          "🌳 Yellow Wood Play Park — Ücretsiz",
          "🚲 Bisiklet Sürme — Ücretsiz (Kendi bisikletinizi getirin)",
          "🏰 Jumping Castle — Ücretsiz",
          "🥕 Hayvan Besleme — ZAR 30",
          "🚜 OX Wagon Tour — ZAR 60 yetişkin / ZAR 50 çocuk"
        ]
      },
      {
        emoji: "🧺",
        title: "Piknik Alanları",
        content: [
          "💚 Braai Area — ZAR 350",
          "💚 Grass Area — ZAR 5,500 (giriş dahil)",
          "💚 Ottoman Corner — ZAR 1,500 (giriş hariç)"
        ]
      },
      {
        content: "Giriş: 2 yetişkin × ZAR 50 = ZAR 100 | 3 çocuk × ZAR 25 = ZAR 75 | Toplam giriş: ZAR 175"
      }
    ],
    cta: { label: "📅 Rezervasyon Yap", action: "reservation" }
  };
}

export function generatePricingGeneralResponse(): ChatResponse {
  return {
    type: "pricing",
    sections: [
      {
        emoji: "🎟️",
        title: "Giriş Ücreti",
        content: [
          "🧑 Yetişkin — ZAR 50",
          "👧 Çocuk — ZAR 25"
        ]
      },
      {
        emoji: "🧺",
        title: "Piknik & Alanlar",
        content: [
          "Braai Area — ZAR 350",
          "Ottoman Corner — ZAR 1,500 (giriş hariç)",
          "Grass Area — ZAR 5,500 (giriş dahil)",
          "Grass Area + Çadır (9×16m) — ZAR 10,000"
        ]
      },
      {
        emoji: "⛺",
        title: "Çadırlar",
        content: [
          "Pangola (3×3m) — ZAR 100",
          "Pangola (5×10m) — ZAR 2,500",
          "Frame (6×9m) — ZAR 2,500",
          "Frame (5×15m) — ZAR 4,000",
          "Frame (9×16m) — ZAR 5,500"
        ]
      },
      {
        emoji: "🎉",
        title: "Etkinlik Alanları",
        content: [
          "White Swan & Pool — ZAR 2,500 (giriş hariç)",
          "Amphitheater — ZAR 3,000 (giriş hariç)",
          "The Barn Hall — ZAR 35,000 (giriş dahil)"
        ]
      },
      {
        emoji: "🪑",
        title: "Ekstra Ürünler",
        content: [
          "6-Seater Picnic Table — ZAR 70",
          "Plastic Table — ZAR 60",
          "Plastic Chair — ZAR 20"
        ]
      },
      {
        emoji: "🚙",
        title: "Diğer Hizmetler",
        content: [
          "Golf Cart (4 kişi + şoför) — ZAR 2,000",
          "OX Wagon Tour — ZAR 60 yetişkin / ZAR 50 çocuk",
          "Hayvan Besleme — ZAR 30",
          "Fotoğraf Çekimi — ZAR 1,200 tam gün / ZAR 600 (0–4 saat)"
        ]
      }
    ]
  };
}

export function generateOpeningHoursResponse(): ChatResponse {
  return {
    type: "text",
    sections: [
      {
        emoji: "🕒",
        title: "Çalışma Saatleri",
        content: [
          "Pazartesi — Kapalı",
          "Salı – Cuma — 10:00 – 18:00",
          "Cumartesi – Pazar — 09:00 – 18:00"
        ]
      }
    ]
  };
}

export function generateLocationResponse(): ChatResponse {
  return {
    type: "text",
    sections: [
      {
        emoji: "📍",
        title: "Chamlija Konumu",
        content: "Chamlija Doğa Koruma Alanı, Güney Afrika"
      }
    ],
    cta: { label: "📍 Google Maps'te Aç", action: "location" }
  };
}

export function generateReservationResponse(input: string = ""): ChatResponse {
  const area = detectReservationArea(input);
  const normalized = normalize(input);
  const language = getLanguage(input);

  const areaText = area ?
    (language === "tr" ? `"${area}" alanı için` : `for the "${area}"`) :
    (language === "tr" ? "rezervasyon için" : "for your reservation");

  const mainText = area
    ? (language === "tr"
      ? `Absolut! 😊 ${areaText} rezervasyon sürecine yönlendireceğim. Lütfen tarih, misafir sayısı ve alan seçimini rezervasyon sayfasında tamamlayın. Rezervasyonunuz, işlem tamamlanana kadar kesinleşmez.`
      : `Absolutely 😊 I can help you with that. You can continue to the reservation page to choose your date, guest count and picnic area. Your reservation is only confirmed once the booking process is completed.`)
    : (language === "tr"
      ? "Absolut! 😊 Rezervasyon için rezervasyon sayfasına devam edebilirsiniz. Lütfen tarih, misafir sayısı ve alan seçimini orada tamamlayın. Rezervasyonunuz, işlem tamamlanana kadar kesinleşmez."
      : "Absolutely 😊 I can help with that. You can continue to the reservation page to choose your date, guest count and picnic area. Your reservation will only be confirmed after the booking process is completed.");

  return {
    type: "text",
    sections: [
      {
        emoji: "📅",
        title: language === "tr" ? "Rezervasyon" : "Reservation",
        content: [mainText]
      }
    ],
    cta: {
      label: language === "tr" ? "📅 Rezervasyon Sayfası" : "📅 Make a Reservation",
      action: "reservation",
      href: buildReservationHref(input),
    }
  };
}

export function generateAnimalsResponse(): ChatResponse {
  return {
    type: "text",
    sections: [
      {
        emoji: "🐾",
        title: "Chamlija'daki Hayvanlar",
        content: "Chamlija'da yaklaşık 50 türde hayvan vardır:",
        subtitle: "🐔 Tavuk, 🐪 Deve, 🐇 Tavşan, 🦆 Ördek, 🦙 Lama, 🫏 Eşek, 🐕 Köpek, 🐑 Koyun, 🐿️ Sincap, 🐐 Keçi, 🦃 Hindi, 🪿 Kaz ve diğerleri."
      },
      {
        emoji: "🥕",
        title: "Hayvan Besleme",
        content: "Hayvanları beslemek isterseniz, hayvan yemi ZAR 30'dir."
      }
    ]
  };
}

export function generateRulesResponse(): ChatResponse {
  return {
    type: "text",
    sections: [
      {
        emoji: "⚠️",
        title: "Chamlija Kuralları",
        content: [
          "❌ Alkol yasaktır",
          "❌ Müzik yasaktır",
          "✅ Doğayı saygıyla kullanın"
        ]
      }
    ]
  };
}

export function generateUnknownResponse(): ChatResponse {
  return {
    type: "text",
    sections: [
      {
        emoji: "🤔",
        title: "Anladığım Konularda Yardımcı Olmaya Hazırım",
        content: [
          "💰 Fiyatlar",
          "🌿 Aktiviteler",
          "👨‍👩‍👧 Aile Önerileri",
          "🕒 Çalışma Saatleri",
          "📍 Konum",
          "📅 Rezervasyon",
          "✨ Gün Planı"
        ]
      },
      {
        content: "Başka konular hakkında bilgi almak için lütfen +27 65 585 9178 numarasını arayın veya buyukchamlija@uict.org.za adresine e-posta gönderin."
      }
    ]
  };
}

export function generateGroupQuoteResponse(input: string): ChatResponse {
  const language = getLanguage(input);
  const counts = parseSchoolGroupCounts(input);
  const adults = counts.adults;
  const children = counts.children;
  const entrance = adults * 50 + children * 25;
  const areaMatches = {
    "ottoman": { label: "Ottoman Corner", price: 1500 },
    "grass": { label: "Grass Area", price: 5500 },
    "braai": { label: "Braai Area", price: 350 },
    "picnic": { label: "Picnic Area", price: 0 },
  };

  const selectedArea = Object.entries(areaMatches).find(([key]) => normalize(input).includes(key))?.[1];
  const areaPrice = selectedArea?.price ?? 0;
  const totalWithArea = entrance + areaPrice;

  const baseText = language === "tr"
    ? `Evet, fiyat teklifi hazırlayabilirim. ${adults} yetişkin ve ${children} çocuk için giriş ücreti ${formatCurrency(entrance)} olur.`
    : `Yes, I can prepare a quote. For ${adults} adults and ${children} children, the entrance fee is ${formatCurrency(entrance)}.`;

  const areaText = selectedArea
    ? language === "tr"
      ? `Seçtiğiniz alan ${selectedArea.label} ise alan ücreti ${formatCurrency(areaPrice)} eklenir. Toplam tahmini ${formatCurrency(totalWithArea)} olur.`
      : `If you choose ${selectedArea.label}, the area fee adds ${formatCurrency(areaPrice)}. The estimated total would be ${formatCurrency(totalWithArea)}.`
    : language === "tr"
      ? `İsterseniz uygun alan seçeneklerini de önerebilirim: Ottoman Corner, Grass Area veya Braai Area. Hangi köşeyi tercih edersiniz?`
      : `I can also suggest the best picnic area options for your group, such as Ottoman Corner, Grass Area, or Braai Area. Which corner would you prefer?`;

  return {
    type: "pricing",
    sections: [
      {
        emoji: "💰",
        title: language === "tr" ? "Fiyat Teklifi" : "Price Quote",
        content: [baseText, areaText],
      },
    ],
    cta: {
      label: language === "tr" ? "📅 Rezervasyon İsteği Gönder" : "📅 Send Reservation Request",
      action: "reservation",
      href: buildReservationHref(input),
    },
  };
}

export function generateFacilityCheckResponse(input: string): ChatResponse {
  const language = getLanguage(input);
  const normalized = normalize(input);

  const isTurkish = language === "tr";
  const isEnglish = language === "en";

  const unsupportedFacilityMatches = [
    "horse riding",
    "horseback",
    "archery",
    "zip line",
    "zipline",
    "spa",
    "pool",
    "waterslide",
    "kayaking",
    "quad biking",
    "boat trip",
    "mini train",
    "tennis court",
  ];

  const unsupportedMatch = unsupportedFacilityMatches.find((term) => normalized.includes(term));
  if (unsupportedMatch) {
    const message = `At the moment, ${unsupportedMatch} is not one of the activities we offer at Chamlija. We currently offer verified options such as ${getVerifiedActivityExamples()}`;
    return {
      type: "text",
      sections: [{
        emoji: "ℹ️",
        title: isTurkish ? "Doğrulanmış bilgi" : "Verified information",
        content: [
          isTurkish ? "Bu seçenek şu anda Chamlija'da doğrulanmış bir hizmet olarak mevcut değil." : "This option is not currently a verified Chamlija offering.",
          message,
          getVerifiedNoDataResponse(input),
        ],
      }],
    };
  }

  if (containsAny(normalized, ["otopark", "parking", "car park", "free parking", "park", "araç park"] )) {
    return {
      type: "text",
      sections: [{
        emoji: "🚗",
        title: isTurkish ? "Ücretsiz Otopark" : "Free Parking",
        content: [
          isTurkish ? "Evet, ücretsiz otoparkımız mevcuttur." : "Yes, we have free on-site parking available.",
          isTurkish ? "Araçlarınızı güvenle park edebilir ve ziyarete başlayabilirsiniz." : "You can park your vehicle safely on site before entering the park.",
        ],
      }],
    };
  }

  if (containsAny(normalized, ["mangal", "braai", "barbeque", "bbq"] )) {
    return {
      type: "text",
      sections: [{
        emoji: "🔥",
        title: isTurkish ? "Mangal / Braai Seçenekleri" : "Braai / BBQ Options",
        content: [
          isTurkish ? "Evet, mangal yapma imkanı için piknik alanı seçeneklerimizi inceleyebilirsiniz." : "Yes, you can plan a braai setup through our picnic area options.",
          isTurkish ? "Braai Area, Grass Area ve Ottoman Corner arasından uygun alan seçimi yapılabilir." : "You can choose from the Braai Area, Grass Area, or Ottoman Corner depending on the event size and setup.",
        ],
      }],
      cta: { label: isTurkish ? "📅 Alan Seçimi" : "📅 Choose an Area", action: "reservation" },
    };
  }

  if (containsAny(normalized, ["balik", "fishing", "fish", "angling", "tutma"])) {
    return {
      type: "text",
      sections: [{
        emoji: "🎣",
        title: isTurkish ? "Balık Tutma" : "Fishing",
        content: [
          isTurkish ? "Maalesef şu anda balık tutma hizmetimiz mevcut değildir." : "Unfortunately, fishing is not currently offered at Chamlija.",
          isTurkish ? "Detaylı bilgi için lütfen alan ekibimizle iletişime geçin." : "For the most up-to-date information, please contact our team directly.",
        ],
      }],
    };
  }

  if (containsAny(normalized, ["at binisi", "horse riding", "ride horse", "horseback"])) {
    return {
      type: "text",
      sections: [{
        emoji: "🐎",
        title: isTurkish ? "At Binme" : "Horse Riding",
        content: [
          isTurkish ? "Maalesef şu anda at binme hizmetimiz mevcut değildir." : "At the moment, horse riding is not available at Chamlija.",
          isTurkish ? "Sahip olduğumuz diğer açık hava aktivitelerini inceleyebilirsiniz." : "You can still explore the other outdoor activities available on site.",
        ],
      }],
    };
  }

  if (containsAny(normalized, ["yemek", "food", "restaurant", "dining", "eat", "coffee", "cay", "tea", "cold drink", "soguk icecek", "dondurma", "popcorn", "pancake", "pankek", "hamburger", "kara", "karinja", "delibite", "country bazaar"])) {
    return {
      type: "text",
      sections: [{
        emoji: "🍽️",
        title: isTurkish ? "İçeride Yemek & İçecek" : "Dining & Refreshments",
        content: [
          isTurkish ? "Evet, içerde çeşitli yiyecek ve içecek seçenekleri mevcut." : "Yes, there are food and refreshment options available on site.",
          isTurkish ? "Karinja Türk restoranı, Delibite hamburger & hızlı servis, Country Bazaar marketi, çay, soğuk içecekler, Türk kahvesi, pankek, popcorn ve dondurma alanları bulunmaktadır." : "We have Karinja Turkish restaurant, Delibite for burgers and quick bites, Country Bazaar market, tea, cold drinks, Turkish coffee, pancakes, popcorn, and ice cream available on site.",
        ],
      }],
    };
  }

  if (containsAny(normalized, ["amphitheater", "amfitiyatro", "amphitheatre", "group", "80", "100", "100 kisilik", "90", "group of 80", "grouppicnic"])) {
    const groupSize = /\d+/.exec(normalized)?.[0] ?? "80";
    const suggestionText = isTurkish
      ? `80-100 kişilik bir grup için ${groupSize} kişilik planla birlikte Amphitheater ve piknik alanı kombinasyonu uygun olabilir. Amphitheater giriş ücreti hariç ZAR 3,000 ve picnic alanı seçenekleri Braai Area / Ottoman Corner / Grass Area arasında değerlendirilebilir.`
      : `For a group of 80–100 guests, a strong option is to combine the Amphitheater with a picnic area setup. The Amphitheater is ZAR 3,000 excluding entry fees, and the picnic area options can be reviewed between Braai Area, Ottoman Corner, and Grass Area.`;

    return {
      type: "pricing",
      sections: [{
        emoji: "🎯",
        title: isTurkish ? "Önerilen Grup Planı" : "Suggested Group Setup",
        content: [suggestionText],
      }],
      cta: { label: isTurkish ? "📅 Rezervasyon Yap" : "📅 Reserve Now", action: "reservation" },
    };
  }

  if (containsAny(normalized, ["cocuk oyun alanı", "play park", "yellow wood", "playground", "oyun alanı"])) {
    return {
      type: "text",
      sections: [{
        emoji: "🌳",
        title: isTurkish ? "Çocuk Oyun Alanı" : "Play Park",
        content: [
          isTurkish ? "Evet, Yellow Wood Play Park ve çocuk dostu açık alanlarımız mevcut." : "Yes, we have the Yellow Wood Play Park and child-friendly outdoor spaces available.",
          isTurkish ? "Bu alanlar aile ziyaretleri için uygun bir seçenek sunar." : "These are suitable for family visits and relaxed group outings.",
        ],
      }],
    };
  }

  if (containsAny(normalized, ["namaz", "prayer", "ibadet", "salah", "shalat", "namaz kilin", "prayer room", "prayer area", "namazsa"])) {
    return {
      type: "text",
      sections: [{
        emoji: "🕌",
        title: isTurkish ? "Namaz Kılma Yerleri" : "Prayer Facilities",
        content: [
          isTurkish ? "Evet, kadınlar ve erkekler için ayrı namaz kılma yerleri mevcuttur." : "Yes, we have separate prayer facilities for men and women available on site.",
          isTurkish ? "Ziyaretçilerimiz rahat bir şekilde ibadetlerini gerçekleştirebilirler." : "Visitors can perform their prayers comfortably on our grounds.",
        ],
      }],
    };
  }

  if (containsAny(normalized, ["tuvalet", "toilet", "wc", "restroom", "bathroom", "tuvalet var", "bathroom facilities", "bathroom"])) {
    return {
      type: "text",
      sections: [{
        emoji: "🚻",
        title: isTurkish ? "Tuvaletler" : "Toilet Facilities",
        content: [
          isTurkish ? "Evet, temiz ve düzenli tuvaletlerimiz mevcuttur." : "Yes, we have clean and well-maintained toilet facilities available.",
          isTurkish ? "Erkek, kadın ve engelli ziyaretçiler için tuvaletlerimiz bulunmaktadır." : "We have toilets available for men, women, and visitors with disabilities.",
        ],
      }],
    };
  }

  if (containsAny(normalized, ["helal", "halal", "halaal", "kosher", "halal food", "halal yemek", "helal mi", "helal mı", "helal beslenme", "islamic food", "halal certifie", "helal belge"])) {
    return {
      type: "text",
      sections: [{
        emoji: "✅",
        title: isTurkish ? "Helal Yemekler" : "HALAL Certified Food",
        content: [
          isTurkish ? "Evet, tüm yiyeceklerimiz 100% HELALdır." : "Yes, all our food options are 100% HALAL certified.",
          isTurkish ? "Karinja Türk restoranı, Delibite'deki hamburger ve hızlı servis yemekleri dahil olmak üzere tüm gıdalar HELALdır. Country Bazaar'daki ürünler de helal kurallarına uygun seçilmiştir." : "This includes Karinja Turkish restaurant, Delibite's burgers and quick bites, and all items available at Country Bazaar are selected according to HALAL standards.",
          isTurkish ? "Beslenme tercihleriniz hakkında endişe etmenize gerek yoktur." : "You can enjoy your meal with complete peace of mind regarding dietary requirements.",
        ],
      }],
    };
  }

  if (containsAny(normalized, ["var mi", "var mı", "available", "do you have", "is there", "is there a", "bulunuyor mu", "mevcut mu"])) {
    return {
      type: "text",
      sections: [{
        emoji: "ℹ️",
        title: isTurkish ? "Onaylı Bilgi" : "Verified Information",
        content: [
          isTurkish ? "Bu hizmetin sitede doğrulanmış bir versiyonu varsa size bildiririm; doğrulanmış olmayan seçenekler hakkında net bilgi vermemeye özen gösteririm." : "If this service is confirmed on our site, I can share it clearly; I avoid giving details about services that are not verified here.",
          isTurkish ? "Daha net bilgi için lütfen alan ekibimizle iletişime geçin." : "For exact confirmation, please contact our team directly.",
        ],
      }],
    };
  }

  return generateUnknownResponse();
}

export function generateAvailabilityResponse(input: string): ChatResponse {
  const language = getLanguage(input);
  const isTurkish = language === "tr";

  // Dynamic import would be ideal, but for now we'll provide a calendar view link
  const availabilityLink = "/book?view=availability";

  const nextDays = isTurkish ? "gelecek 14 gün" : "next 14 days";
  const calendarText = isTurkish
    ? `Evet, takvim üzerinden uygun günleri kontrol edebilirsiniz. Dolu ve boş günler renklendirilerek gösterilir.`
    : `Yes, you can check available dates on our calendar. Booked and available dates are clearly marked.`;

  const howToCheckText = isTurkish
    ? `Açılır takvim üzerinden ${nextDays} içindeki uygun günleri görebilir, direkt olarak rezervasyon yapabilirsiniz.`
    : `Using the interactive calendar, you can see available dates within the ${nextDays} and book directly.`;

  return {
    type: "text",
    sections: [
      {
        emoji: "📅",
        title: isTurkish ? "Uygun Günler" : "Available Dates",
        content: [
          calendarText,
          howToCheckText,
          isTurkish 
            ? "Kırmızı renkli günler dolu (rezerve edilmiş), yeşil günler uygun (boş)."
            : "Red dates are booked, green dates are available for reservation.",
        ],
      },
    ],
    cta: {
      label: isTurkish ? "📅 Takvimi Açarak Kontrol Et" : "📅 Check Calendar",
      action: "reservation",
      href: availabilityLink,
    },
  };
}

export function buildChamlijaAIResponse(input: string): ChatResponse {
  const normalized = normalize(input);
  const intent = detectIntent(input);
  const counts = {
    adults: parseNumbers(normalize(input)).find((value) => value > 0) ?? undefined,
    children: parseNumbers(normalize(input)).slice(1).find((value) => value >= 0) ?? undefined,
  };

  const directAnswer = getDirectAnswer(input, normalized);
  if (directAnswer) {
    return directAnswer;
  }

  const photoShootAnswer = getPhotoShootAnswer(input, normalized);
  if (photoShootAnswer) {
    return photoShootAnswer;
  }

  const paidActivityPaymentAnswer = getPaidActivityPaymentAnswer(input, normalized);
  if (paidActivityPaymentAnswer) {
    return paidActivityPaymentAnswer;
  }

  const verifiedAnswer = getVerifiedDirectAnswer(input, normalized);
  if (verifiedAnswer) {
    return verifiedAnswer;
  }

  const knownActivityHints = [
    "animal viewing",
    "yellow wood",
    "play park",
    "bike riding",
    "basketball",
    "cricket",
    "beach volleyball",
    "mini golf",
    "jumping castle",
    "nature",
    "animal feeding",
    "ox wagon",
    "braai",
    "ottoman",
    "grass area",
    "parking",
    "location",
    "opening hours",
  ];

  const asksAboutService = /(do you have|is there|available|offer|provide|have .*service|have .*activity)/i.test(input);
  const isUnknownServiceRequest = asksAboutService && !knownActivityHints.some((hint) => normalized.includes(hint));

  if (isUnknownServiceRequest) {
    const verifiedMessage = `I don't currently have verified information about that at Chamlija. We currently offer verified options such as ${getVerifiedActivityExamples()}.`;
    return {
      type: "text",
      sections: [{
        emoji: "ℹ️",
        title: "Verified Chamlija information",
        content: [verifiedMessage, getVerifiedNoDataResponse(input)],
      }],
    };
  }

  const hasBudgetSignals = containsAny(normalize(input), ["cheap", "affordable", "budget", "low cost", "don't want to spend much", "not spend much", "free", "less than", "under", "cheap", "ucuz", "bütçe", "düşük"]);
  const hasFamilySignals = containsAny(normalize(input), ["family", "children", "kids", "aile", "cocuk", "çocuk", "with kids"]);

  if (hasBudgetSignals && hasFamilySignals && (counts.adults || counts.children)) {
    const adults = counts.adults ?? 2;
    const children = counts.children ?? 2;
    const entranceTotal = adults * 50 + children * 25;

    return {
      type: "pricing",
      sections: [
        {
          emoji: "💚",
          title: "Family-friendly budget plan",
          content: [
            `For ${adults} adults and ${children} children, I’d start with free options like Animal Viewing, Yellow Wood Play Park and nature areas.`,
            `Entrance total: ${adults} × ZAR 50 = ZAR ${adults * 50} | ${children} × ZAR 25 = ZAR ${children * 25}`,
            `Estimated entrance total: ZAR ${entranceTotal}`,
          ],
          subtitle: "If you want something extra, Animal Feeding is ZAR 30 and the OX Wagon Tour is ZAR 60 adult / ZAR 50 child."
        }
      ],
      cta: { label: "📅 Make a Reservation", action: "reservation", href: buildReservationHref(input) }
    };
  }

  switch (intent) {
    case "greeting":
      return generateGreetingResponse(input);
    case "how-are-you":
      return generateHowAreYouResponse(input);
    case "activities":
      return generateActivitiesResponse();
    case "family-recommendation":
      return generateFamilyRecommendationResponse();
    case "pricing-general":
      return generatePricingGeneralResponse();
    case "opening-hours":
      return generateOpeningHoursResponse();
    case "location":
      return generateLocationResponse();
    case "reservation":
      return generateReservationResponse(input);
    case "plan-day":
      return generatePlanMyDayResponse(input);
    case "animals":
      return generateAnimalsResponse();
    case "rules":
      return generateRulesResponse();
    case "own-furniture":
      return generateOwnFurnitureResponse(input);
    case "group-quote":
      return generateGroupQuoteResponse(input);
    case "facility-check":
      return generateFacilityCheckResponse(input);
    case "availability-check":
      return generateAvailabilityResponse(input);
    default:
      return generateUnknownResponse();
  }
}

function getPhotoShootAnswer(input: string, normalized: string): ChatResponse | null {
  if (!containsAny(normalized, ["fotograf", "photo", "photography"])) {
    return null;
  }

  const isTurkish = isTurkishInput(input);
  return {
    type: "pricing",
    sections: [{
      content: [isTurkish
        ? "Fotoğraf çekimi: Tüm gün R1.200, 0–4 saat R600."
        : "Photo Shoot: Full day ZAR 1,200; 0–4 hours ZAR 600."],
    }],
  };
}

function getPaidActivityPaymentAnswer(input: string, normalized: string): ChatResponse | null {
  const activityMentioned = containsAny(normalized, [
    "ox wagon",
    "oxwagon",
    "ox-wagon",
    "wagon ride",
    "wagon tour",
    "hayvan besleme",
    "animal feeding",
    "feed animals",
  ]);
  const advancePaymentQuestion = containsAny(normalized, [
    "advance",
    "in advance",
    "pay now",
    "payment now",
    "pay for",
    "pay during",
    "pay when",
    "online payment",
    "online booking",
    "reservation payment",
    "before your visit",
    "simdi odem",
    "önceden ödem",
    "rezervasyon yaparken",
    "rezervasyon sirasinda",
    "rezervasyon sırasında",
    "simdi mi",
  ]);

  if (!activityMentioned || !advancePaymentQuestion) {
    return null;
  }

  const isTurkish = isTurkishInput(input);
  return {
    type: "text",
    sections: [{
      content: [isTurkish
        ? "Hayır, bu aktiviteler için önceden ödeme yapmanız gerekmez. Oxwagon Ride ve Animal Feeding ücretlerini Chamlija'ya geldiğinizde doğrudan ödeyebilirsiniz."
        : "No, you do not need to pay for these activities in advance. Activities such as Oxwagon Rides and Animal Feeding can be paid for directly at Chamlija when you arrive."],
    }],
  };
}

function getVerifiedDirectAnswer(input: string, normalized: string): ChatResponse | null {
  const isTurkish = isTurkishInput(input);
  const adultMatch = normalized.match(/(\d+)\s*(yetiskin|adult)/);
  const childMatch = normalized.match(/(\d+)\s*(cocuk|child|children|kid|kids)/);
  const hasEntryQuestion = containsAny(normalized, ["giris", "ucret", "fiyat", "ne kadar", "how much", "price", "entry", "entrance"]);
  const hasGuestCounts = Boolean(adultMatch || childMatch);

  if (hasEntryQuestion && hasGuestCounts) {
    const adults = Number(adultMatch?.[1] ?? 0);
    const children = Number(childMatch?.[1] ?? 0);
    const total = adults * VERIFIED_CHAMLIJA_FACTS.pricing.adult + children * VERIFIED_CHAMLIJA_FACTS.pricing.child3Plus;
    const dayAnswer = getOpeningHoursAnswer(normalized, isTurkish);

    return {
      type: "pricing",
      sections: [{
        content: [
          dayAnswer,
          isTurkish
            ? `${adults} yetişkin ve ${children} çocuk için giriş toplamı R${total}.`
            : `Entry for ${adults} adults and ${children} children is R${total}.`,
        ].filter(Boolean),
      }],
    };
  }

  if (hasEntryQuestion && containsAny(normalized, ["yetiskin", "adult"]) && !hasGuestCounts) {
    return {
      type: "pricing",
      sections: [{ content: [isTurkish ? "Yetişkin giriş ücreti R50." : "Adult entrance is R50."] }],
    };
  }

  if (containsAny(normalized, ["hayvan besleme", "animal feeding", "feed animals"]) && hasEntryQuestion) {
    return {
      type: "pricing",
      sections: [{ content: [isTurkish ? "Hayvan besleme ücreti R30." : "Animal Feeding is R30."] }],
    };
  }

  if (containsAny(normalized, ["ox wagon", "ox wagon tour", "okskar" ]) && hasEntryQuestion) {
    return {
      type: "pricing",
      sections: [{ content: [isTurkish ? "OX Wagon Tour ücreti yetişkin R60, çocuk R50." : "The OX Wagon Tour is R60 for adults and R50 for children."] }],
    };
  }

  if (containsAny(normalized, ["acik", "open", "calisma saat", "opening hours", "saatleri", "cumartesi", "pazar", "saturday", "sunday", "pazartesi", "monday", "sali", "tuesday", "carsamba", "wednesday", "persembe", "thursday", "cuma", "friday"])) {
    return {
      type: "text",
      sections: [{ content: [getOpeningHoursAnswer(normalized, isTurkish)] }],
    };
  }

  return null;
}

function getOpeningHoursAnswer(normalized: string, isTurkish: boolean): string {
  const isMonday = containsAny(normalized, ["pazartesi", "monday"]);
  const isSaturday = containsAny(normalized, ["cumartesi", "saturday"]);
  const isSunday = containsAny(normalized, ["pazar", "sunday"]);
  const day = isMonday
    ? (isTurkish ? "Pazartesi" : "Monday")
    : isSaturday && isSunday
      ? (isTurkish ? "Cumartesi/Pazar" : "Saturday/Sunday")
      : isSaturday
        ? (isTurkish ? "Cumartesi" : "Saturday")
        : isSunday
          ? (isTurkish ? "Pazar" : "Sunday")
          : "";

  if (isMonday) {
    return isTurkish ? "Pazartesi günleri kapalıyız." : "We are closed on Mondays.";
  }

  if (day) {
    return isTurkish ? `${day} günü 09:00–18:00 açığız.` : `We are open ${day} from 09:00–18:00.`;
  }

  return isTurkish
    ? "Pazartesi kapalıyız; Salı–Cuma 10:00–18:00, Cumartesi–Pazar 09:00–18:00 açığız."
    : "We are closed on Mondays; Tuesday–Friday 10:00–18:00 and Saturday–Sunday 09:00–18:00.";
}

function getDirectAnswer(input: string, normalized: string): ChatResponse | null {
  const isTurkish = isTurkishInput(input);
  const equipmentActivity = containsAny(normalized, ["bisiklet", "bicycle", "basketbol", "basketball", "golf", "cricket", "beach volleyball"]);
  const equipmentQuestion = containsAny(normalized, ["ekipman", "equipment", "getir", "bring", "own", "kendi", "gerekiyor", "need", "should", "var mi", "mevcut", "available"]);

  if (containsAny(normalized, ["ata binme", "ata binebilir", "at binebilir", "at surebiliyor", "at surme", "at turu", "at biniliyor", "horse riding", "ride horse", "horseback"])) {
    return {
      type: "text",
      sections: [{ content: [isTurkish ? "Maalesef şu an öyle bir hizmetimiz mevcut değil." : "Horse riding is not currently available at Chamlija."] }],
    };
  }

  if (containsAny(normalized, ["dogum gunu kutla", "dogum gunu yap", "birthday celebration", "birthday party", "celebrate a birthday"])) {
    return {
      type: "text",
      sections: [{ content: [isTurkish ? "Evet, tabii ki." : "Yes, of course."] }],
    };
  }

  if (containsAny(normalized, ["dogum gunu pastasi", "kendi pastam", "birthday cake", "own cake"])) {
    return {
      type: "text",
      sections: [{ content: [isTurkish ? "Evet, getirebilirsiniz." : "Yes, you can bring it."] }],
    };
  }

  if (equipmentActivity && equipmentQuestion) {
    const equipmentAnswer = containsAny(normalized, ["bisiklet", "bicycle"])
      ? (isTurkish ? "Evet, kendi bisikletinizi getirmeniz gerekiyor." : "Yes, you need to bring your own bicycle.")
      : containsAny(normalized, ["basketbol", "basketball"])
        ? (isTurkish ? "Basketbol için kendi ekipmanınızı getirmeniz gerekiyor." : "For basketball, you need to bring your own equipment.")
        : containsAny(normalized, ["golf"])
          ? (isTurkish ? "Golf için kendi ekipmanınızı getirmeniz gerekiyor." : "For golf, you need to bring your own equipment.")
          : (isTurkish ? "Evet, kendi ekipmanlarınızı getirmeniz gerekiyor." : "Yes, you need to bring your own equipment.");

    return {
      type: "text",
      sections: [{ content: [equipmentAnswer] }],
    };
  }

  return null;
}
