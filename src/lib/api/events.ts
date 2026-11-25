/** Internal audit action → public webhook event name. Only these are delivered. */
export const eventFor: Record<string, string> = {
  "contact.create": "contact.created",
  "contact.update": "contact.updated",
  "contact.delete": "contact.deleted",
  "company.create": "company.created",
  "company.update": "company.updated",
  "deal.create": "deal.created",
  "deal.update": "deal.updated",
  "deal.move": "deal.stage_changed",
  "deal.won": "deal.won",
  "deal.lost": "deal.lost",
  "deal.reopen": "deal.reopened",
  "deal.delete": "deal.deleted",
  "ticket.create": "ticket.created",
  "ticket.update": "ticket.updated",
  "appointment.create": "appointment.created",
  "appointment.update": "appointment.updated",
  "appointment.status": "appointment.updated",
};

export const webhookEvents = [...new Set(Object.values(eventFor))];
