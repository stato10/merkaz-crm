import { contactStatuses, dealStatuses, ticketPriorities, ticketStatuses } from "../labels";
import { webhookEvents } from "./events";

const id = { type: "string", format: "uuid" } as const;
const ts = { type: "string", format: "date-time" } as const;
const nstr = { type: ["string", "null"] } as const;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const page = (item: string) => ({
  type: "object",
  required: ["data", "next_cursor"],
  properties: { data: { type: "array", items: ref(item) }, next_cursor: { type: ["string", "null"] } },
});
const errors = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "429": { $ref: "#/components/responses/RateLimited" },
};
const pageParams = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "next_cursor from the previous page" },
];
const idParam = [{ name: "id", in: "path", required: true, schema: id }];

function crud(tag: string, item: string, create: string, update: string, filters: object[] = [], del = false) {
  const base = `/${tag}`;
  return {
    [base]: {
      get: { tags: [tag], summary: `List ${tag}`, parameters: [...pageParams, ...filters], responses: { "200": { description: "OK", content: json(page(item)) }, ...errors } },
      post: {
        tags: [tag],
        summary: `Create ${item.toLowerCase()}`,
        requestBody: { required: true, content: json(ref(create)) },
        responses: { "201": { description: "Created", content: json(ref(item)) }, "422": { $ref: "#/components/responses/Invalid" }, ...errors },
      },
    },
    [`${base}/{id}`]: {
      parameters: idParam,
      get: { tags: [tag], summary: `Get ${item.toLowerCase()}`, responses: { "200": { description: "OK", content: json(ref(item)) }, "404": { $ref: "#/components/responses/NotFound" }, ...errors } },
      patch: {
        tags: [tag],
        summary: `Update ${item.toLowerCase()}`,
        requestBody: { required: true, content: json(ref(update)) },
        responses: { "200": { description: "OK", content: json(ref(item)) }, "404": { $ref: "#/components/responses/NotFound" }, "422": { $ref: "#/components/responses/Invalid" }, ...errors },
      },
      ...(del && { delete: { tags: [tag], summary: `Delete ${item.toLowerCase()}`, responses: { "204": { description: "Deleted" }, "404": { $ref: "#/components/responses/NotFound" }, ...errors } } }),
    },
  };
}

const errorBody = {
  type: "object",
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "request_id"],
      properties: { code: { type: "string" }, message: { type: "string" }, request_id: { type: "string" }, details: {} },
    },
  },
};

const contactInput = {
  type: "object",
  properties: {
    first_name: { type: "string", maxLength: 80 },
    last_name: { type: "string" },
    email: { type: ["string", "null"], format: "email" },
    phone: nstr,
    title: nstr,
    source: nstr,
    status: { enum: contactStatuses },
    tags: { type: "array", items: { type: "string" }, maxItems: 20 },
    company_id: { ...id, type: ["string", "null"] },
    owner_id: nstr,
  },
};

export function openApiSpec(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "CRM API",
      version: "1.0.0",
      description:
        "REST API for contacts, companies, deals and tickets. Authenticate with an organization API key " +
        "(Settings → Developers) as `Authorization: Bearer crm_live_…`. Every key is limited to 120 requests " +
        "per minute; see the RateLimit-* response headers. Lists use cursor pagination. Data is isolated per " +
        "organization by Postgres row-level security.",
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ bearer: [] }],
    tags: [
      { name: "contacts" },
      { name: "companies" },
      { name: "deals" },
      { name: "tickets" },
      { name: "webhooks", description: `Events: ${webhookEvents.join(", ")}` },
    ],
    paths: {
      "/me": { get: { summary: "Current key and organization", responses: { "200": { description: "OK" }, ...errors } } },
      ...crud("contacts", "Contact", "ContactCreate", "ContactUpdate", [
        { name: "q", in: "query", schema: { type: "string" }, description: "Search name, email, phone" },
        { name: "status", in: "query", schema: { enum: contactStatuses } },
        { name: "email", in: "query", schema: { type: "string" } },
        { name: "company_id", in: "query", schema: id },
      ], true),
      ...crud("companies", "Company", "CompanyCreate", "CompanyUpdate", [{ name: "q", in: "query", schema: { type: "string" } }]),
      "/pipeline/stages": { get: { tags: ["deals"], summary: "Pipeline stages in order", responses: { "200": { description: "OK" }, ...errors } } },
      ...crud("deals", "Deal", "DealCreate", "DealUpdate", [
        { name: "status", in: "query", schema: { enum: dealStatuses } },
        { name: "stage_id", in: "query", schema: id },
        { name: "contact_id", in: "query", schema: id },
      ]),
      ...crud("tickets", "Ticket", "TicketCreate", "TicketUpdate", [{ name: "status", in: "query", schema: { enum: ticketStatuses } }]),
    },
    webhooks: {
      event: {
        post: {
          summary: "Event delivery",
          description:
            "POSTed to your endpoint for every subscribed event. Verify `X-CRM-Signature: t=<unix>,v1=<hex>` where v1 = " +
            "HMAC-SHA256(secret, `${t}.${raw body}`). Respond 2xx within 10s; failures are retried with exponential backoff up to 8 times.",
          requestBody: {
            content: json({
              type: "object",
              properties: { id: { type: "string" }, type: { enum: webhookEvents }, created_at: ts, data: { type: "object" }, changes: { type: "object" } },
            }),
          },
          responses: { "200": { description: "Acknowledged" } },
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Organization API key" } },
      responses: {
        Unauthorized: { description: "Missing or invalid API key", content: json(errorBody) },
        Forbidden: { description: "Key role lacks permission", content: json(errorBody) },
        NotFound: { description: "Not found in this organization", content: json(errorBody) },
        Invalid: { description: "Validation failed", content: json(errorBody) },
        RateLimited: { description: "Too many requests; see Retry-After", content: json(errorBody) },
      },
      schemas: {
        Contact: {
          type: "object",
          properties: { id, ...contactInput.properties, created_at: ts, updated_at: ts },
        },
        ContactCreate: { ...contactInput, required: ["first_name"] },
        ContactUpdate: contactInput,
        Company: {
          type: "object",
          properties: { id, name: { type: "string" }, domain: nstr, industry: nstr, phone: nstr, address: nstr, owner_id: nstr, created_at: ts, updated_at: ts },
        },
        CompanyCreate: { type: "object", required: ["name"], properties: { name: { type: "string" }, domain: nstr, industry: nstr, phone: nstr, address: nstr, owner_id: nstr } },
        CompanyUpdate: { type: "object", properties: { name: { type: "string" }, domain: nstr, industry: nstr, phone: nstr, address: nstr, owner_id: nstr } },
        Deal: {
          type: "object",
          properties: {
            id,
            title: { type: "string" },
            amount: { type: "integer", description: "Whole currency units" },
            currency: { type: "string", example: "ILS" },
            stage_id: id,
            status: { enum: dealStatuses },
            contact_id: nstr,
            company_id: nstr,
            owner_id: nstr,
            expected_close: { type: ["string", "null"], format: "date" },
            closed_at: { type: ["string", "null"], format: "date-time" },
            lost_reason: nstr,
            stage_changed_at: ts,
            created_at: ts,
            updated_at: ts,
          },
        },
        DealCreate: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            amount: { type: "integer", minimum: 0 },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            stage_id: { ...id, description: "Defaults to the first stage" },
            contact_id: nstr,
            company_id: nstr,
            owner_id: nstr,
            expected_close: { type: ["string", "null"], format: "date" },
          },
        },
        DealUpdate: {
          type: "object",
          description: "Set stage_id to move the deal; status won/lost closes it (lost requires lost_reason); status open reopens.",
          properties: {
            title: { type: "string" },
            amount: { type: "integer" },
            stage_id: id,
            status: { enum: dealStatuses },
            lost_reason: { type: "string" },
            contact_id: nstr,
            company_id: nstr,
            owner_id: nstr,
            expected_close: { type: ["string", "null"], format: "date" },
          },
        },
        Ticket: {
          type: "object",
          properties: {
            id,
            number: { type: "integer" },
            subject: { type: "string" },
            status: { enum: ticketStatuses },
            priority: { enum: ticketPriorities },
            channel: { type: "string" },
            contact_id: nstr,
            assignee_id: nstr,
            resolved_at: { type: ["string", "null"], format: "date-time" },
            last_message_at: ts,
            created_at: ts,
            updated_at: ts,
          },
        },
        TicketCreate: {
          type: "object",
          required: ["subject", "body"],
          properties: {
            subject: { type: "string" },
            body: { type: "string", description: "The customer's first message" },
            contact_id: nstr,
            assignee_id: nstr,
            priority: { enum: ticketPriorities },
            channel: { enum: ["api", "web", "email", "phone", "whatsapp"] },
          },
        },
        TicketUpdate: {
          type: "object",
          properties: { status: { enum: ticketStatuses }, priority: { enum: ticketPriorities }, assignee_id: nstr },
        },
      },
    },
  };
}
