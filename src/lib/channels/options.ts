/** Provider choices per channel kind (shared with the browser, so no Node imports here). */
export const providersFor = {
  email: [
    { id: "sandbox", label: "סביבת בדיקה (בלי שליחה אמיתית)" },
    { id: "postmark", label: "Postmark" },
  ],
  whatsapp: [
    { id: "sandbox", label: "סביבת בדיקה (בלי שליחה אמיתית)" },
    { id: "meta", label: "WhatsApp Cloud API של Meta" },
  ],
} as const;
