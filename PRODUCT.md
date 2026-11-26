# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Businesses that buy the CRM and adapt it to their own way of working. Inside each business, the people in it every day are service agents, sales reps, managers and owners: handling customer requests, appointments, deals and the team. The owner intends to sell it to many businesses, each with its own customization, so it must work for a single owner and for a full service center.

## Product Purpose

One full-capability CRM for sales and service together: contacts and companies, a ticket inbox, appointments, deals, communication channels, dashboards, roles and permissions. Success is a system an organization can run its customer operation on, and that can be sold and tailored per customer.

## Positioning

An AI agent answers customers by voice, WhatsApp and chat, and hands a conversation to a person with the full context when a human is needed. The CRM is where the agent's work and the team's work meet: every handoff lands as a ticket with the history, the appointment and the customer record attached.

## Operating Context

- Hebrew-first, right-to-left interface; business time zone Asia/Jerusalem.
- Multi-tenant: each organization has its own data, members and roles (owner, admin, sales, service agent).
- Used for hours at a desk by staff, and in short checks from a phone by owners.
- Origin: a service-center pilot (appointments, rescheduling, handoff to an agent) in `pilot/`.

## Capabilities and Constraints

- Built: contacts, companies, activity timeline, team and roles, ticket inbox with conversation thread, appointments with clash check, deals with a drag-and-drop pipeline board, weighted forecast and won/lost outcomes, public REST API with API keys and rate limits, signed webhooks with retries, Postgres row-level security for tenant isolation, CSV import/export, audit log, demo organization with one-click demo login, a Claude agent that drafts ticket replies and hands off to a human, a staff copilot that searches and acts in the CRM under the user's own permissions, an MCP server over the same tools, an eval suite for the agent, and WhatsApp and email channels: customer messages open or continue tickets, and replies go back on the same channel with delivery status.
- Planned: editable pipeline stages in settings, website chat, WhatsApp templates for replies after 24 hours, voice via LiveKit, dashboards and reports.
- Per-customer customization is a goal; how far it goes (branding, fields, workflows) is undecided.
- Stack: Next.js 16, React 19, Tailwind v4, Postgres with Drizzle, Better Auth; Vitest + Playwright, GitHub Actions CI, Docker.
- Audience for the build itself: the codebase doubles as a portfolio piece, so engineering quality (tests, CI, docs, security) is part of the product.

## Brand Commitments

The name "מרכז" and the current logo are placeholders and can change freely.

Visual direction is pinned by the owner (2026-11-18): follow the "SaaS CRM UI Kit" Figma file (`6dFxRBgxIo5fwLfWQTcLXx`) as the look and craft bar, adapted for Hebrew RTL and WCAG AA. See DESIGN.md.

## Evidence on Hand

No real customers, testimonials or metrics yet. Sample data in the database is fictional and must not be presented as real.

## Product Principles

1. The customer's whole story in one place: service, sales and AI conversations around the same record.
2. The AI does the routine work, and a person can take over at any moment with full context.
3. Fast for people who live in it all day, clear for someone opening it for a minute on a phone.
4. Hebrew and right-to-left are native, not translated.
5. Every organization can shape it to fit without breaking it for the others.
