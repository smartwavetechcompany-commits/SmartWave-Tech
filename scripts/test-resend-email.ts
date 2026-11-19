import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import {
  sendEmail,
  validateEmailConfig,
  getAppUrl,
} from "../src/services/emailService.ts";

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
  const timestamp = new Date().toISOString();

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, Helvetica, sans-serif; color: #18181b; line-height: 1.6; padding: 20px;">
  <h2 style="margin-top: 0;">Transactional Email Verification</h2>
  <p>This is a one-time transactional email delivery test from your hotel application.</p>
  <p>Portal link: <a href="${appUrl}">${appUrl}</a></p>
  <p style="font-size: 12px; color: #71717a;">Timestamp: ${timestamp}</p>
</body>
</html>`;

  const text = [
    "Transactional Email Verification",
    "",
    "This is a one-time transactional email delivery test from your hotel application.",
    `Portal link: ${appUrl}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");

  const result = await sendEmail({
    to: testRecipient,
    subject: "Transactional Email Test - Tide Hotels",
    html,
    text,
  });

  if (result.success) {
    console.log(`SUCCESS | messageId=${result.messageId}`);
    process.exit(0);
  }

  console.error(`FAILURE | error=${result.error || "Unknown error"}`);
  process.exit(1);
}

main().catch((err: any) => {
  console.error(`FAILURE | error=${err?.message || "Unexpected error"}`);
  process.exit(1);
});
