import React, { useEffect, useMemo, useState } from "react";
import {
  Braces,
  Check,
  Copy,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  ALLOWED_TEMPLATE_VARIABLES,
  VARIABLE_DESCRIPTIONS,
  type AllowedTemplateVariable,
} from "../shared/types";

type VariableGroup =
  | "All"
  | "Guest"
  | "Hotel"
  | "Stay"
  | "Billing"
  | "Loyalty"
  | "Operations"
  | "Links";

const VARIABLE_GROUPS: VariableGroup[] = [
  "All",
  "Guest",
  "Hotel",
  "Stay",
  "Billing",
  "Loyalty",
  "Operations",
  "Links",
];

interface AvailableVariablesDrawerProps {
  open: boolean;
  onClose: () => void;
  canInsertDirectly: boolean;
  activeFieldLabel?: string | null;
  resolvedVariables?: Record<string, string>;
  onInsertVariable: (varName: AllowedTemplateVariable) => void;
}

export function AvailableVariablesDrawer({
  open,
  onClose,
  canInsertDirectly,
  activeFieldLabel,
  resolvedVariables,
  onInsertVariable,
}: AvailableVariablesDrawerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<VariableGroup>("All");
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const filteredVariables = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ALLOWED_TEMPLATE_VARIABLES.filter((varName) => {
      const meta = VARIABLE_DESCRIPTIONS[varName];
      if (!meta) return false;
      if (selectedGroup !== "All" && meta.group !== selectedGroup) {
        return false;
      }
      if (!q) return true;
      const sampleVal = (resolvedVariables?.[varName] || meta.sample || "").toLowerCase();
      return (
        varName.toLowerCase().includes(q) ||
        `{{${varName}}}`.toLowerCase().includes(q) ||
        meta.label.toLowerCase().includes(q) ||
        meta.group.toLowerCase().includes(q) ||
        sampleVal.includes(q)
      );
    });
  }, [searchQuery, selectedGroup, resolvedVariables]);

  const groupedVariables = useMemo(() => {
    const map = new Map<string, AllowedTemplateVariable[]>();
    for (const varName of filteredVariables) {
      const grp = VARIABLE_DESCRIPTIONS[varName]?.group || "Other";
      const list = map.get(grp) || [];
      list.push(varName);
      map.set(grp, list);
    }
    return Array.from(map.entries());
  }, [filteredVariables]);

  const handleCopyOnly = (e: React.MouseEvent, varName: AllowedTemplateVariable) => {
    e.stopPropagation();
    const tag = `{{${varName}}}`;
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(tag);
      setCopiedVar(varName);
      toast.success(`Copied ${tag}`);
      window.setTimeout(() => {
        setCopiedVar((curr) => (curr === varName ? null : curr));
      }, 1500);
    }
  };

  if (!open) return null;

  return (
    <aside
      aria-label="Available Variables"
      className="fixed inset-y-0 right-0 z-[90] w-full max-w-md bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col"
    >
      {/* Drawer Header */}
      <div className="px-4 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-3 bg-zinc-900/70">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 shrink-0">
            <Braces size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-100 truncate">
                Available Variables
              </h2>
              <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                {ALLOWED_TEMPLATE_VARIABLES.length}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 truncate">
              {canInsertDirectly
                ? "Click any variable to insert directly at your cursor."
                : "Click any variable to copy, or open a template to insert directly."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close Available Variables"
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Active Target Field Indicator */}
      <div className="px-4 py-2 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between gap-2 text-[11px]">
        {canInsertDirectly ? (
          <div className="flex items-center gap-1.5 text-zinc-300 min-w-0">
            <Sparkles size={12} className="text-emerald-400 shrink-0" />
            <span className="text-zinc-400 shrink-0">Inserting into:</span>
            <span className="font-medium text-emerald-300 truncate">
              {activeFieldLabel || "Subject Line (click any field to target)"}
            </span>
          </div>
        ) : (
          <div className="text-zinc-400">
            Open any template with <span className="text-zinc-200 font-medium">Customize</span> to
            enable one-click cursor insertion.
          </div>
        )}
      </div>

      {/* Search & Group Filters */}
      <div className="px-4 py-3 border-b border-zinc-800 space-y-2.5 bg-zinc-950">
        <div className="relative">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search placeholders (e.g. guest_name, hotel_name, total)..."
            className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-zinc-500 hover:text-zinc-200"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {VARIABLE_GROUPS.map((grp) => {
            const active = selectedGroup === grp;
            return (
              <button
                key={grp}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSelectedGroup(grp)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                  active
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                    : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                }`}
              >
                {grp}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Variable List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {groupedVariables.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-500">
            No matching variables found for &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          groupedVariables.map(([groupName, vars]) => (
            <div key={groupName} className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {groupName}
                </h3>
                <span className="text-[10px] text-zinc-600 tabular-nums">{vars.length}</span>
              </div>

              <div className="space-y-1.5">
                {vars.map((varName) => {
                  const meta = VARIABLE_DESCRIPTIONS[varName];
                  const resolvedPreview = resolvedVariables?.[varName];
                  const sampleText =
                    resolvedPreview && resolvedPreview.trim()
                      ? resolvedPreview.trim()
                      : meta.sample;
                  const tag = `{{${varName}}}`;
                  const isCopied = copiedVar === varName;

                  return (
                    <div
                      key={varName}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onInsertVariable(varName)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onInsertVariable(varName);
                        }
                      }}
                      className="group w-full text-left rounded-lg bg-zinc-900/70 hover:bg-zinc-900 border border-zinc-800 hover:border-emerald-500/45 p-2.5 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="text-xs font-mono font-semibold text-emerald-400">
                              {tag}
                            </code>
                          </div>
                          <div className="text-xs text-zinc-200 font-medium leading-snug">
                            {meta.label}
                          </div>
                          {sampleText && (
                            <div
                              className="text-[11px] text-zinc-500 truncate"
                              title={sampleText}
                            >
                              Preview: {sampleText}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0 pt-0.5">
                          <span
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600/15 group-hover:bg-emerald-600 text-emerald-300 group-hover:text-white border border-emerald-500/30 text-[11px] font-medium transition-colors"
                          >
                            <Plus size={11} />
                            {canInsertDirectly ? "Insert" : "Copy"}
                          </span>
                          {canInsertDirectly && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => handleCopyOnly(e, varName)}
                              title={`Copy ${tag}`}
                              className="p-1.5 rounded-md border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
                            >
                              {isCopied ? (
                                <Check size={11} className="text-emerald-400" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer Note */}
      <div className="px-4 py-2.5 border-t border-zinc-800 bg-zinc-900/50 text-[11px] text-zinc-500">
        Only allow-listed variables above can be saved. Unknown placeholders or script syntax are
        blocked automatically.
      </div>
    </aside>
  );
}
