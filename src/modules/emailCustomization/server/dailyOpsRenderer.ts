/**
 * Dedicated Branded HTML & Plain-Text Email Renderer for the
 * Automated Daily Hotel Operations Report.
 *
 * - Strictly separate from guest transactional templates.
 * - Uses existing hotel branding (logo, colors, name, contact).
 * - Preserves uploaded logo natural aspect ratio (no stretching/distortion).
 * - Contains ZERO financial figures and ZERO guest PII.
 * - All dynamic values are strictly HTML-escaped.
 */

import { escapeHtml } from "../../../utils/serverSecurity.ts";
import {
  DEFAULT_DAILY_OPS_SECTIONS,
  type DailyOpsMovementItem,
  type DailyOpsReportData,
  type DailyOpsReportSectionsConfig,
} from "../shared/dailyOpsTypes.ts";

export interface DailyOpsBrandInfo {
  hotelName: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  address?: string;
  phone?: string;
  supportEmail?: string;
  replyTo?: string;
}

export interface RenderedDailyOpsEmail {
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string;
}

function sanitizeColor(color: unknown, fallback: string): string {
  if (typeof color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(color.trim())) {
    return color.trim();
  }
  return fallback;
}

function sanitizeImageUrl(url: unknown): string {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

function renderMetricGrid(items: Array<{ label: string; value: string | number; accent?: string }>): string {
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 3) {
    const chunk = items.slice(i, i + 3);
    const cells = chunk
      .map(
        (item) => `
      <td width="33.33%" valign="top" style="padding:6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
          <tr>
            <td style="padding:12px 14px;">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#64748b;margin-bottom:4px;">${escapeHtml(item.label)}</div>
              <div style="font-size:20px;font-weight:700;color:${escapeHtml(item.accent || "#0f172a")};font-family:'SFMono-Regular',Consolas,monospace;">${escapeHtml(String(item.value))}</div>
            </td>
          </tr>
        </table>
      </td>`
      )
      .join("");
    const emptyCells = Array.from({ length: 3 - chunk.length })
      .map(() => `<td width="33.33%" style="padding:6px;"></td>`)
      .join("");
    rows.push(`<tr>${cells}${emptyCells}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 -6px;">${rows.join("")}</table>`;
}

function renderKeyValueTable(rows: Array<{ label: string; value: string | number }>): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      ${rows
        .map(
          (r, idx) => `
        <tr style="background:${idx % 2 === 0 ? "#ffffff" : "#f8fafc"};">
          <td style="padding:9px 12px;font-size:13px;color:#334155;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.label)}</td>
          <td align="right" style="padding:9px 12px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0;font-family:'SFMono-Regular',Consolas,monospace;">${escapeHtml(String(r.value))}</td>
        </tr>`
        )
        .join("")}
    </table>`;
}

function renderMovementList(title: string, items: DailyOpsMovementItem[]): string {
  if (items.length === 0) {
    return `
      <div style="margin-top:12px;">
        <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:4px;">${escapeHtml(title)} (0)</div>
        <div style="font-size:12px;color:#64748b;padding:8px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;">None recorded for this period.</div>
      </div>`;
  }
  return `
    <div style="margin-top:12px;">
      <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">${escapeHtml(title)} (${items.length})</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;font-size:12px;">
        <tr style="background:#f1f5f9;">
          <th align="left" style="padding:7px 10px;color:#475569;font-weight:700;border-bottom:1px solid #e2e8f0;">Ref</th>
          <th align="left" style="padding:7px 10px;color:#475569;font-weight:700;border-bottom:1px solid #e2e8f0;">Room</th>
          <th align="left" style="padding:7px 10px;color:#475569;font-weight:700;border-bottom:1px solid #e2e8f0;">Guest</th>
          <th align="left" style="padding:7px 10px;color:#475569;font-weight:700;border-bottom:1px solid #e2e8f0;">Status / Note</th>
        </tr>
        ${items
          .map(
            (it, idx) => `
          <tr style="background:${idx % 2 === 0 ? "#ffffff" : "#f8fafc"};">
            <td style="padding:7px 10px;font-family:'SFMono-Regular',Consolas,monospace;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(it.reservationRef)}</td>
            <td style="padding:7px 10px;font-weight:600;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(it.roomNumber)}</td>
            <td style="padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">${escapeHtml(it.guestInitials)}</td>
            <td style="padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">${escapeHtml(it.detail || it.status)}</td>
          </tr>`
          )
          .join("")}
      </table>
    </div>`;
}

function renderSectionBlock(title: string, subtitle: string, bodyHtml: string, primaryColor: string): string {
  return `
    <tr>
      <td style="padding:20px 28px 4px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="border-left:4px solid ${escapeHtml(primaryColor)};padding-left:12px;">
              <h2 style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(title)}</h2>
              ${subtitle ? `<p style="margin:3px 0 0 0;font-size:12px;color:#64748b;">${escapeHtml(subtitle)}</p>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 28px 14px 28px;">
        ${bodyHtml}
      </td>
    </tr>`;
}

export function renderDailyOperationsReportEmail(
  report: DailyOpsReportData,
  brand: DailyOpsBrandInfo,
  sectionsConfig?: Partial<DailyOpsReportSectionsConfig>
): RenderedDailyOpsEmail {
  const sections: DailyOpsReportSectionsConfig = {
    ...DEFAULT_DAILY_OPS_SECTIONS,
    ...(sectionsConfig || {}),
  };

  const hotelName = brand.hotelName || report.hotelName || "Hotel Property";
  const primaryColor = sanitizeColor(brand.primaryColor, "#0f766e");
  const secondaryColor = sanitizeColor(brand.secondaryColor, "#0f172a");
  const logoUrl = sanitizeImageUrl(brand.logoUrl);

  const subject = `Daily Hotel Operations Report – ${hotelName} – ${report.reportDate}`;

  const sectionsHtml: string[] = [];

  // 1. Occupancy Summary
  if (sections.occupancy) {
    const occ = report.occupancy;
    const body = `
      ${renderMetricGrid([
        { label: "Occupancy Rate", value: `${occ.occupancyPercentage}%`, accent: primaryColor },
        { label: "Occupied Rooms", value: occ.occupiedRooms, accent: "#0f172a" },
        { label: "Vacant Rooms", value: occ.vacantRooms, accent: "#0369a1" },
      ])}
      ${renderKeyValueTable([
        { label: "Total Room Inventory (Cutoff)", value: occ.totalRoomInventory },
        { label: "Current In-House Guests (Cutoff)", value: occ.currentInHouseGuests },
        { label: "Total Arrivals Checked In (Reporting Day)", value: occ.totalArrivals },
        { label: "Total Departures Checked Out (Reporting Day)", value: occ.totalDepartures },
        { label: "Expected Arrivals (Reporting Day)", value: occ.expectedArrivals },
        { label: "Expected Departures (Reporting Day)", value: occ.expectedDepartures },
        { label: "Extended Stays Recorded", value: occ.extendedStays },
      ])}
    `;
    sectionsHtml.push(
      renderSectionBlock(
        "Occupancy Summary",
        "Cutoff room occupancy vs. reporting-day arrival and departure activity",
        body,
        primaryColor
      )
    );
  }

  // 2. Room Status Summary
  if (sections.roomStatus) {
    const snap = report.roomStatus.endOfDaySnapshot;
    const trans = report.roomStatus.dailyTransitions;
    const transitionsNote =
      trans.notableChanges.length > 0
        ? `
          <div style="margin-top:12px;">
            <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">Room Status Changes Recorded During Reporting Day (${trans.totalRecorded})</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;font-size:12px;">
              ${trans.notableChanges
                .slice(0, 8)
                .map(
                  (c, idx) => `
                <tr style="background:${idx % 2 === 0 ? "#ffffff" : "#f8fafc"};">
                  <td style="padding:6px 10px;font-weight:600;color:#0f172a;border-bottom:1px solid #e2e8f0;width:95px;">Room ${escapeHtml(c.roomNumber)}</td>
                  <td style="padding:6px 10px;color:#334155;border-bottom:1px solid #e2e8f0;">${escapeHtml(c.action)}</td>
                </tr>`
                )
                .join("")}
            </table>
          </div>`
        : `<p style="margin:10px 0 0 0;font-size:12px;color:#64748b;">Recorded intra-day room status events: ${trans.totalRecorded} (Cleanings: ${trans.cleaningsCompleted}, Inspections Passed: ${trans.inspectionsPassed}, Failed: ${trans.inspectionsFailed}).</p>`;

    const body = `
      ${renderMetricGrid([
        { label: "Total Rooms", value: snap.totalRooms },
        { label: "Available & Ready", value: snap.available, accent: "#059669" },
        { label: "Reserved", value: snap.reserved, accent: "#2563eb" },
        { label: "Dirty", value: snap.dirty, accent: "#d97706" },
        { label: "Clean / Inspected", value: `${snap.clean} / ${snap.inspected}`, accent: "#0d9488" },
        { label: "Blocked / OOO / Maint.", value: `${snap.blocked} / ${snap.outOfOrder} / ${snap.underMaintenance}`, accent: "#dc2626" },
      ])}
      ${renderKeyValueTable([
        { label: "Occupied Rooms (End-of-Day Cutoff)", value: snap.occupied },
        { label: "Vacant Rooms (End-of-Day Cutoff)", value: snap.vacant },
        { label: "Awaiting Cleaning", value: snap.awaitingCleaning },
        { label: "Awaiting Inspection", value: snap.awaitingInspection },
        { label: "Blocked Rooms", value: snap.blocked },
        { label: "Out-of-Order / Out-of-Service Rooms", value: snap.outOfOrder },
        { label: "Rooms Under Maintenance", value: snap.underMaintenance },
      ])}
      ${transitionsNote}
    `;
    sectionsHtml.push(
      renderSectionBlock(
        "Room Status Summary",
        "End-of-day inventory snapshot separated from intra-day status transitions",
        body,
        primaryColor
      )
    );
  }

  // 3. Reservation Summary
  if (sections.reservations) {
    const r = report.reservations;
    const body = `
      ${renderMetricGrid([
        { label: "Created Today", value: r.totalCreated },
        { label: "Checked In", value: r.checkedIn, accent: "#059669" },
        { label: "Checked Out", value: r.checkedOut, accent: "#0369a1" },
        { label: "Confirmed / Pending", value: `${r.confirmed} / ${r.pending}` },
        { label: "Cancelled", value: r.cancelled, accent: "#dc2626" },
        { label: "No-Show", value: r.noShow, accent: "#d97706" },
      ])}
      ${renderKeyValueTable([
        { label: "Walk-In Reservations", value: r.walkIn },
        { label: "Early Check-Ins Recorded", value: r.earlyCheckIns },
        { label: "Early Check-Outs Recorded", value: r.earlyCheckOuts },
      ])}
      <p style="margin:8px 0 0 0;font-size:11px;color:#64748b;">Note: Cancelled and No-Show reservations are excluded from completed stays and occupancy counts.</p>
    `;
    sectionsHtml.push(
      renderSectionBlock(
        "Reservation Summary",
        "Deduplicated reservation activity for the reporting calendar day",
        body,
        primaryColor
      )
    );
  }

  // 4. Arrivals & Departures
  if (sections.arrivalsDepartures) {
    const ad = report.arrivalsDepartures;
    const body = `
      ${renderMovementList("Guests Checked In", ad.checkedIn)}
      ${renderMovementList("Guests Checked Out", ad.checkedOut)}
      ${renderMovementList("Expected Arrivals Not Checked In", ad.expectedNotCheckedIn)}
      ${renderMovementList("No-Show Reservations", ad.noShows)}
      ${renderMovementList("Cancelled Reservations", ad.cancelled)}
      ${ad.earlyArrivals.length > 0 ? renderMovementList("Early Arrivals", ad.earlyArrivals) : ""}
      ${ad.earlyDepartures.length > 0 ? renderMovementList("Early Departures", ad.earlyDepartures) : ""}
      ${ad.walkIns.length > 0 ? renderMovementList("Walk-In Arrivals", ad.walkIns) : ""}
      <p style="margin:10px 0 0 0;font-size:11px;color:#64748b;">Guest privacy notice: Only reservation references, room numbers, and masked initials are shown.</p>
    `;
    sectionsHtml.push(
      renderSectionBlock(
        "Arrivals & Departures",
        "Operational movement summary without guest personal contact details",
        body,
        primaryColor
      )
    );
  }

  // 5. Housekeeping Summary
  if (sections.housekeeping) {
    const hk = report.housekeeping;
    const body = `
      ${renderMetricGrid([
        { label: "Released & Ready", value: hk.releasedAndReady, accent: "#059669" },
        { label: "Awaiting Cleaning", value: hk.awaitingCleaning, accent: "#d97706" },
        { label: "Awaiting Inspection", value: hk.awaitingInspection, accent: "#2563eb" },
      ])}
      ${renderKeyValueTable([
        { label: "Dirty Rooms", value: hk.dirtyRooms },
        { label: "Clean Rooms", value: hk.cleanRooms },
        { label: "Inspected Rooms", value: hk.inspectedRooms },
        { label: "Housekeeping Tasks Completed (Reporting Day)", value: hk.completedTasks },
        { label: "Pending Housekeeping Tasks", value: hk.pendingTasks },
        { label: "Total Outstanding Housekeeping Items", value: hk.outstandingTasks },
        { label: "Active Guest Housekeeping Requests", value: hk.activeGuestRequests },
      ])}
    `;
    sectionsHtml.push(
      renderSectionBlock(
        "Housekeeping Summary",
        "Room readiness, cleaning completions, and inspection pipeline",
        body,
        primaryColor
      )
    );
  }

  // 6. Maintenance Summary
  if (sections.maintenance) {
    const m = report.maintenance;
    const reqTable =
      m.requests.length > 0
        ? `
          <div style="margin-top:12px;">
            <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">Active &amp; Reporting-Day Maintenance Requests (${m.requests.length})</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;font-size:12px;">
              <tr style="background:#f1f5f9;">
                <th align="left" style="padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">Room</th>
                <th align="left" style="padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">Category</th>
                <th align="left" style="padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">Priority</th>
                <th align="left" style="padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">Status</th>
                <th align="left" style="padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">Issue</th>
              </tr>
              ${m.requests
                .map(
                  (req, idx) => `
                <tr style="background:${idx % 2 === 0 ? "#ffffff" : "#f8fafc"};">
                  <td style="padding:7px 10px;font-weight:600;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(req.roomNumber)}</td>
                  <td style="padding:7px 10px;color:#334155;border-bottom:1px solid #e2e8f0;">${escapeHtml(req.category)}</td>
                  <td style="padding:7px 10px;text-transform:uppercase;font-size:11px;font-weight:700;color:${req.priority === "high" || req.priority === "urgent" ? "#dc2626" : "#475569"};border-bottom:1px solid #e2e8f0;">${escapeHtml(req.priority)}</td>
                  <td style="padding:7px 10px;color:#334155;border-bottom:1px solid #e2e8f0;">${escapeHtml(req.status.replace(/_/g, " "))}</td>
                  <td style="padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">${escapeHtml(req.summary)}</td>
                </tr>`
                )
                .join("")}
            </table>
          </div>`
        : `<p style="margin:10px 0 0 0;font-size:12px;color:#64748b;">No open or reporting-day maintenance requests recorded.</p>`;

    const body = `
      ${renderMetricGrid([
        { label: "Under Maintenance", value: m.roomsUnderMaintenance, accent: "#d97706" },
        { label: "Out of Order", value: m.outOfOrderRooms, accent: "#dc2626" },
        { label: "Outstanding Issues", value: m.outstandingRequests, accent: "#b91c1c" },
      ])}
      ${renderKeyValueTable([
        { label: "New Maintenance Requests (Reporting Day)", value: m.newRequests },
        { label: "Pending Requests", value: m.pendingRequests },
        { label: "In-Progress Requests", value: m.inProgressRequests },
        { label: "Completed Requests (Reporting Day)", value: m.completedRequests },
      ])}
      ${reqTable}
    `;
    sectionsHtml.push(
      renderSectionBlock(
        "Maintenance Summary",
        "Room maintenance blocks and engineering ticket status",
        body,
        primaryColor
      )
    );
  }

  // 7. Additional Operational Information
  if (sections.additionalOps) {
    const ops = report.additionalOps;
    const vipRefsText =
      ops.vipArrivalsRefs.length > 0
        ? ops.vipArrivalsRefs.map((v) => `${v.reservationRef} (Room ${v.roomNumber})`).join(", ")
        : "None recorded";

    const body = `
      ${renderKeyValueTable([
        { label: "Room Transfers Recorded (Reporting Day)", value: ops.roomTransfersCount },
        { label: "Active Room Blocks (Reporting Day)", value: ops.roomBlocksActive },
        { label: "VIP Arrivals (Count)", value: ops.vipArrivalsCount },
        { label: "VIP Arrival References", value: vipRefsText },
        { label: "Extended Stays Active / Recorded", value: ops.extendedStaysCount },
        { label: "Outstanding Operational Tasks", value: ops.outstandingOperationalTasks },
      ])}
    `;
    sectionsHtml.push(
      renderSectionBlock(
        "Additional Operational Information",
        "VIP arrivals, room blocks, transfers, and pending operational tasks",
        body,
        primaryColor
      )
    );
  }

  const limitationsHtml =
    report.limitations.length > 0
      ? `
        <tr>
          <td style="padding:10px 28px 18px 28px;">
            <div style="padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;">
              <strong>Data Completeness Notes:</strong>
              <ul style="margin:6px 0 0 18px;padding:0;">
                ${report.limitations.map((l) => `<li style="margin-bottom:3px;">${escapeHtml(l)}</li>`).join("")}
              </ul>
            </div>
          </td>
        </tr>`
      : "";

  const generatedDisplay = (() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: report.timezone,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(report.generatedAt));
    } catch {
      return report.generatedAt;
    }
  })();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 2px 10px rgba(15,23,42,0.06);">
          <!-- Header -->
          <tr>
            <td style="background:${escapeHtml(secondaryColor)};padding:24px 28px;border-bottom:4px solid ${escapeHtml(primaryColor)};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle">
                    ${
                      logoUrl
                        ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(hotelName)}" style="max-height:48px;max-width:200px;width:auto;height:auto;display:block;margin-bottom:12px;border:0;" />`
                        : ""
                    }
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#94a3b8;">Automated Operational Summary</div>
                    <h1 style="margin:4px 0 0 0;font-size:21px;font-weight:700;color:#ffffff;line-height:1.25;">${escapeHtml(hotelName)}</h1>
                    <div style="margin-top:6px;font-size:13px;color:#cbd5e1;">Daily Hotel Operations Report &middot; ${escapeHtml(report.reportDate)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Reporting Period Banner -->
          <tr>
            <td style="background:#f8fafc;padding:14px 28px;border-bottom:1px solid #e2e8f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#334155;">
                <tr>
                  <td><strong>Reporting Period:</strong> ${escapeHtml(report.periodLabel)}</td>
                </tr>
                <tr>
                  <td style="padding-top:4px;color:#64748b;"><strong>Generated:</strong> ${escapeHtml(generatedDisplay)} &middot; <strong>Scope:</strong> Operational Only (No Financial Data)</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Report Sections -->
          ${sectionsHtml.join("")}

          ${limitationsHtml}

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:18px 28px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.5;">
              <div style="font-weight:700;color:#334155;">${escapeHtml(hotelName)}</div>
              ${brand.address ? `<div>${escapeHtml(brand.address)}</div>` : ""}
              <div>
                ${brand.phone ? `Tel: ${escapeHtml(brand.phone)}` : ""}
                ${brand.phone && brand.supportEmail ? " &middot; " : ""}
                ${brand.supportEmail ? `Email: ${escapeHtml(brand.supportEmail)}` : ""}
              </div>
              <div style="margin-top:8px;color:#94a3b8;">
                This automated operational report was generated exclusively for ${escapeHtml(hotelName)} from live PMS operational records.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    subject,
    `Reporting Period: ${report.periodLabel}`,
    `Generated: ${generatedDisplay}`,
    `Scope: Operational Only (No Financial Data)`,
    "",
    `OCCUPANCY SUMMARY`,
    `- Occupancy Rate: ${report.occupancy.occupancyPercentage}% (${report.occupancy.occupiedRooms}/${report.occupancy.totalRoomInventory} rooms)`,
    `- Vacant Rooms: ${report.occupancy.vacantRooms}`,
    `- Current In-House Guests: ${report.occupancy.currentInHouseGuests}`,
    `- Arrivals Checked In: ${report.occupancy.totalArrivals} | Departures Checked Out: ${report.occupancy.totalDepartures}`,
    `- Expected Arrivals: ${report.occupancy.expectedArrivals} | Expected Departures: ${report.occupancy.expectedDepartures}`,
    "",
    `ROOM STATUS SUMMARY (End-of-Day Cutoff)`,
    `- Total: ${report.roomStatus.endOfDaySnapshot.totalRooms} | Occupied: ${report.roomStatus.endOfDaySnapshot.occupied} | Vacant: ${report.roomStatus.endOfDaySnapshot.vacant} | Available: ${report.roomStatus.endOfDaySnapshot.available}`,
    `- Reserved: ${report.roomStatus.endOfDaySnapshot.reserved} | Dirty: ${report.roomStatus.endOfDaySnapshot.dirty} | Clean: ${report.roomStatus.endOfDaySnapshot.clean} | Inspected: ${report.roomStatus.endOfDaySnapshot.inspected}`,
    `- Blocked: ${report.roomStatus.endOfDaySnapshot.blocked} | Out-of-Order: ${report.roomStatus.endOfDaySnapshot.outOfOrder} | Maintenance: ${report.roomStatus.endOfDaySnapshot.underMaintenance}`,
    "",
    `RESERVATION SUMMARY`,
    `- Created: ${report.reservations.totalCreated} | Confirmed: ${report.reservations.confirmed} | Pending: ${report.reservations.pending}`,
    `- Checked In: ${report.reservations.checkedIn} | Checked Out: ${report.reservations.checkedOut} | Walk-In: ${report.reservations.walkIn}`,
    `- Cancelled: ${report.reservations.cancelled} | No-Show: ${report.reservations.noShow}`,
    "",
    `HOUSEKEEPING SUMMARY`,
    `- Released & Ready: ${report.housekeeping.releasedAndReady} | Awaiting Cleaning: ${report.housekeeping.awaitingCleaning} | Awaiting Inspection: ${report.housekeeping.awaitingInspection}`,
    `- Completed Tasks: ${report.housekeeping.completedTasks} | Pending Tasks: ${report.housekeeping.pendingTasks} | Outstanding Items: ${report.housekeeping.outstandingTasks}`,
    "",
    `MAINTENANCE SUMMARY`,
    `- Rooms Under Maintenance: ${report.maintenance.roomsUnderMaintenance} | Out-of-Order: ${report.maintenance.outOfOrderRooms}`,
    `- New: ${report.maintenance.newRequests} | Pending: ${report.maintenance.pendingRequests} | In-Progress: ${report.maintenance.inProgressRequests} | Completed: ${report.maintenance.completedRequests}`,
    "",
    `ADDITIONAL OPERATIONAL INFO`,
    `- Room Transfers: ${report.additionalOps.roomTransfersCount} | Active Room Blocks: ${report.additionalOps.roomBlocksActive} | VIP Arrivals: ${report.additionalOps.vipArrivalsCount} | Extended Stays: ${report.additionalOps.extendedStaysCount} | Outstanding Tasks: ${report.additionalOps.outstandingOperationalTasks}`,
  ];

  return {
    subject,
    html,
    text: textLines.join("\n"),
    fromName: hotelName,
    replyTo: brand.replyTo || brand.supportEmail || undefined,
  };
}
