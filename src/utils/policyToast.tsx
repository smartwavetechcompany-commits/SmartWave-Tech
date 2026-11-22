import React from "react";
import { toast } from "sonner";
import type { PolicyBlockDetail, PolicyCheckResult } from "./policyUtils";

/**
 * Displays a clear, structured policy-blocked notification identifying the exact active
 * Admin Control Policy (or RBAC rule), category/section, configured condition, specific reason,
 * and suggested administrative action.
 *
 * Pure UI presentation helper — does not alter any policy condition or permission check.
 */
export function showPolicyBlockedToast(
  policy: PolicyCheckResult | PolicyBlockDetail | string | undefined | null,
  fallbackMessage = "Operation blocked by hotel policy."
): void {
  const detail: PolicyBlockDetail | undefined =
    policy && typeof policy === "object"
      ? "detail" in policy
        ? policy.detail
        : "policyName" in policy
          ? policy
          : undefined
      : undefined;

  if (!detail) {
    const msg =
      typeof policy === "string"
        ? policy
        : policy && typeof policy === "object" && "message" in policy && policy.message
          ? policy.message
          : fallbackMessage;
    toast.error(msg, { duration: 8000 });
    return;
  }

  toast.error(detail.title || "Operation Blocked by Hotel Policy", {
    duration: 9000,
    description: (
      <div className="mt-1 space-y-1.5 text-xs leading-relaxed">
        <div>
          <span className="font-semibold text-zinc-100">Policy: </span>
          <span className="text-zinc-200">{detail.policyName}</span>
        </div>
        <div>
          <span className="font-semibold text-zinc-100">Category: </span>
          <span className="text-zinc-300">{detail.policySection}</span>
        </div>
        {detail.configuredCondition && (
          <div>
            <span className="font-semibold text-zinc-100">Active Rule: </span>
            <span className="text-zinc-300">{detail.configuredCondition}</span>
          </div>
        )}
        <div>
          <span className="font-semibold text-zinc-100">Reason: </span>
          <span className="text-red-200">{detail.reason}</span>
        </div>
        <div>
          <span className="font-semibold text-zinc-100">Suggested Action: </span>
          <span className="text-zinc-300">{detail.suggestedAction}</span>
        </div>
      </div>
    ),
  });
}
