import { CHAMLIJA_LOCATION } from "@/lib/location";

export const VERIFIED_CHAMLIJA_FACTS = {
  location: CHAMLIJA_LOCATION,
  contact: {
    phone: "+27 65 585 9178",
    email: "buyukchamlija@uict.org.za",
    instagram: "@buyukchamlija",
  },
  openingHours: {
    monday: "Closed",
    tuesdayToFriday: "10:00 – 18:00",
    saturdayToSunday: "09:00 – 18:00",
  },
  pricing: {
    adult: 50,
    child3Plus: 25,
    under3: 0,
  },
  freeActivities: [
    "Animal Viewing",
    "Yellow Wood Play Park",
    "Bike Riding",
    "Basketball",
    "Cricket",
    "Beach Volleyball",
    "Mini Golf",
    "Jumping Castle",
    "Nature & Open Areas",
  ],
  paidActivities: [
    { name: "Animal Feeding", price: 30 },
    { name: "OX Wagon Tour", price: { adult: 60, child: 50 } },
  ],
  picnicAreas: [
    { name: "Braai Area", price: 350 },
    { name: "Ottoman Corner", price: 1500 },
    { name: "Grass Area", price: 5500 },
    { name: "Grass Area with Tent 9×16m", price: 10000 },
  ],
  rules: [
    "Alcohol is not allowed.",
    "Music is not allowed.",
  ],
  animals: [
    "camel",
    "rabbit",
    "duck",
    "llama",
    "donkey",
    "dog",
    "sheep",
    "squirrel",
    "goat",
    "pheasant",
    "goose",
    "chicken",
  ],
};

const normalizeFactText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

export function getVerifiedActivityMatch(input: string) {
  const normalized = normalizeFactText(input);

  return VERIFIED_CHAMLIJA_FACTS.freeActivities.concat(
    VERIFIED_CHAMLIJA_FACTS.paidActivities.map((item) => item.name),
  ).find((activity) => {
    const activityValue = normalizeFactText(activity);
    return normalized.includes(activityValue) || activityValue.includes(normalized);
  });
}

export function getVerifiedNoDataResponse(question: string) {
  const cleaned = question.trim();
  return cleaned
    ? `I don't currently have verified information about that at Chamlija. If you want a confirmed answer, please contact us on ${VERIFIED_CHAMLIJA_FACTS.contact.phone} or email ${VERIFIED_CHAMLIJA_FACTS.contact.email}.`
    : "I don't currently have verified information about that at Chamlija. Please contact the team for confirmation.";
}

export function getVerifiedActivityList() {
  return [...VERIFIED_CHAMLIJA_FACTS.freeActivities, ...VERIFIED_CHAMLIJA_FACTS.paidActivities.map((item) => `${item.name} (ZAR ${item.price})`)];
}

export function getVerifiedActivityExamples() {
  return VERIFIED_CHAMLIJA_FACTS.freeActivities.slice(0, 4).join(", ") + ", and other verified activities on site.";
}
