import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import {
  sendEmail,
  validateEmailConfig,
  getAppUrl,
} from "../src/services/emailService.ts";
import {
  resolveHotelBrandContext,
  resolvePlatformBrandContext,
  renderMultiTenantEmail,
  type MultiTenantEmailEventType,
} from "../src/services/multiTenantEmailService.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
dotenv.config();

async function main() {
  const testRecipient = (process.env.TEST_EMAIL_TO || "").trim();
  if (!testRecipient) {
    console.error("FAILURE: TEST_EMAIL_TO environment variable is required.");
    process.exit(1);
  }

  const configCheck = validateEmailConfig();
  if (!configCheck.ok) {
    console.error(`FAILURE: ${configCheck.error}`);
    process.exit(1);
  }

  const appUrl = getAppUrl();

  // Demonstrate dynamic multi-hotel branding isolation across two sample properties
  const sampleHotelA = resolveHotelBrandContext(
    "sample-hotel-alpha",
    {
      name: "Harborview Suites",
      defaultCurrency: "USD",
      branding: {
        primaryColor: "#0f766e",
        secondaryColor: "#134e4a",
        address: "100 Marina Blvd, Coastal City",
        phone: "+1-555-0101",
        email: "frontdesk@harborview.example",
        website: appUrl,
        footerNotes: "Thank you for choosing Harborview Suites.",
      },
      emailConfig: {
        senderDisplayName: "Harborview Suites",
        replyToEmail: "frontdesk@harborview.example",
      },
    },
    appUrl
  );

  const sampleHotelB = resolveHotelBrandContext(
    "sample-hotel-beta",
    {
      name: "Summit Grand Lodge",
      defaultCurrency: "EUR",
      branding: {
        primaryColor: "#1d4ed8",
        secondaryColor: "#1e293b",
        address: "24 Alpine Ridge, Mountain Town",
        phone: "+49-555-0202",
        email: "concierge@summitgrand.example",
        website: appUrl,
        footerNotes: "Summit Grand Lodge Guest Services.",
      },
      emailConfig: {
        senderDisplayName: "Summit Grand Lodge",
        replyToEmail: "concierge@summitgrand.example",
      },
    },
    appUrl
  );

  const platformBrand = resolvePlatformBrandContext(
    { platformName: "Hotel Management Platform" },
    appUrl
  );

  const filterEvent = (process.env.TEST_EMAIL_EVENT || "").trim().toLowerCase();

  const samples: Array<{
    key: string;
    eventType: MultiTenantEmailEventType;
    brand: typeof sampleHotelA;
    recipientName?: string;
    rows: Array<{ label: string; value: string }>;
    ctaLabel: string;
  }> = [
    {
      key: "confirmation",
      eventType: "reservation.confirmed",
      brand: sampleHotelA,
      recipientName: "Alex Morgan",
      rows: [
        { label: "Booking Reference", value: "TEST-CONF-001" },
        { label: "Hotel", value: sampleHotelA.hotelName },
        { label: "Room", value: "Deluxe Suite 204" },
        { label: "Check-in Date", value: "2026-12-01" },
        { label: "Check-out Date", value: "2026-12-04" },
      ],
      ctaLabel: "Hotel Portal",
    },
    {
      key: "checked_in",
      eventType: "reservation.checked_in",
      brand: sampleHotelA,
      recipientName: "Alex Morgan",
      rows: [
        { label: "Booking Reference", value: "TEST-CHKIN-001" },
        { label: "Hotel", value: sampleHotelA.hotelName },
        { label: "Room", value: "Deluxe Suite 204" },
        { label: "Check-in Date", value: "2026-12-01" },
        { label: "Check-out Date", value: "2026-12-04" },
      ],
      ctaLabel: "Hotel Portal",
    },
    {
      key: "checked_out",
      eventType: "reservation.checked_out",
      brand: sampleHotelB,
      recipientName: "Jordan Taylor",
      rows: [
        { label: "Booking Reference", value: "TEST-CHKOUT-002" },
        { label: "Hotel", value: sampleHotelB.hotelName },
        { label: "Room", value: "Alpine King 305" },
        { label: "Total Charges", value: "EUR 640.00" },
        { label: "Amount Paid", value: "EUR 640.00" },
        { label: "Balance Due", value: "EUR 0.00" },
      ],
      ctaLabel: "Hotel Portal",
    },
    {
      key: "cancelled",
      eventType: "reservation.cancelled",
      brand: sampleHotelB,
      recipientName: "Jordan Taylor",
      rows: [
        { label: "Booking Reference", value: "TEST-CANC-002" },
        { label: "Hotel", value: sampleHotelB.hotelName },
        { label: "Room", value: "Alpine King 305" },
        { label: "Check-in Date", value: "2026-12-10" },
        { label: "Check-out Date", value: "2026-12-12" },
      ],
      ctaLabel: "Hotel Portal",
    },
    {
      key: "tracking_code",
      eventType: "tracking_code.request_submitted",
      brand: platformBrand,
      rows: [
        { label: "Request ID", value: "REQ-VERIFY-001" },
        { label: "Request Type", value: "New Hotel Registration" },
        { label: "Hotel Name", value: "Sample Independent Hotel" },
        { label: "Requested Plan", value: "PRO" },
      ],
      ctaLabel: "Review in Admin Portal",
    },
  ];

  const selected = filterEvent
    ? samples.filter((s) => s.key === filterEvent)
    : [samples[0], samples[2], samples[4]];

  if (selected.length === 0) {
    console.error(
      `FAILURE: Unknown TEST_EMAIL_EVENT '${filterEvent}'. Supported: confirmation, checked_in, checked_out, cancelled, tracking_code.`
    );
    process.exit(1);
  }

  let hasFailure = false;
  for (const sample of selected) {
    const rendered = renderMultiTenantEmail(sample.eventType, sample.brand, {
      recipientName: sample.recipientName,
      rows: sample.rows,
      ctaLabel: sample.ctaLabel,
      ctaUrl: appUrl,
    });

    const result = await sendEmail({
      to: testRecipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
      tags: [
        { name: "hotelId", value: sample.brand.hotelId },
        { name: "eventType", value: sample.eventType },
        { name: "testRun", value: "cli" },
      ],
    });

    if (result.success) {
      console.log(`SUCCESS | event=${sample.eventType} | hotel=${sample.brand.hotelId} | messageId=${result.messageId}`);
    } else {
      hasFailure = true;
      console.error(`FAILURE | event=${sample.eventType} | error=${result.error || "Unknown error"}`);
    }
  }

  process.exit(hasFailure ? 1 : 0);
}

main().catch((err: any) => {
  console.error(`FAILURE | error=${err?.message || "Unexpected error"}`);
  process.exit(1);
});
