import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Layers,
  Plus,
  Trash2,
} from "lucide-react";
import {
  type BlockCondition,
  type EmailBlock,
  type EmailBlockType,
  type EmailImageAsset,
} from "../../shared/types";
import { type ValidationIssue } from "../../shared/validation";
import { OPTIONAL_SECTION_PRESETS } from "../../shared/defaultTemplates";
import { buildPlaceholderImageUrl } from "../../shared/presets";
import {
  BLOCK_CATALOG,
  BLOCK_TYPE_LABELS,
  BlockPaletteModal,
} from "../BlockPaletteModal";
import { BlockInspector, type ImageActionCallbacks } from "../BlockInspector";

export type BlockSectionGroup = "all" | "header" | "content" | "cards" | "footer";

const SECTION_GROUP_LABELS: Record<BlockSectionGroup, string> = {
  all: "All Sections",
  header: "Header",
  content: "Hero & Stay",
  cards: "Cards & Lists",
  footer: "Footer & Legal",
};

const SECTION_GROUP_BADGE: Record<Exclude<BlockSectionGroup, "all">, string> = {
  header: "Header",
  content: "Body",
  cards: "Card",
  footer: "Footer",
};

export function getBlockSectionGroup(type: EmailBlockType): Exclude<BlockSectionGroup, "all"> {
  switch (type) {
    case "brand_header":
    case "promo_banner":
    case "membership_strip":
      return "header";
    case "feature_card":
    case "benefits_list":
    case "icon_link_grid":
    case "image_with_list":
      return "cards";
    case "footer":
    case "footer_nav":
    case "legal_section":
    case "social_links":
      return "footer";
    default:
      return "content";
  }
}

const CONDITION_LABELS: Record<BlockCondition, string> = {
  always: "Always show",
  has_loyalty: "Show only if guest has loyalty data",
  has_balance_due: "Show only if balance is due",
  has_deposit: "Show only if deposit/payment exists",
};

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmailBlock(type: EmailBlockType, appUrl: string): EmailBlock {
  const id = makeId("blk");
  switch (type) {
    case "heading":
      return { id, type: "heading", level: 2, text: "Section Heading", align: "left" };
    case "paragraph":
      return {
        id,
        type: "paragraph",
        text: "Add your message text here.",
        align: "left",
        tone: "default",
      };
    case "image":
      return {
        id,
        type: "image",
        src: "",
        alt: "{{hotel_name}} image",
        widthPx: 540,
        align: "center",
      };
    case "button":
      return {
        id,
        type: "button",
        label: "View Booking Details",
        url: "{{portal_link}}",
        displayStyle: "solid",
        align: "left",
      };
    case "divider":
      return { id, type: "divider", color: "#e4e4e7", thicknessPx: 1 };
    case "spacer":
      return { id, type: "spacer", heightPx: 16 };
    case "booking_details_table":
      return {
        id,
        type: "booking_details_table",
        title: "Reservation Summary",
        rows: [
          {
            id: makeId("row"),
            label: "Booking Reference",
            valueTemplate: "{{booking_reference}}",
            visible: true,
          },
          { id: makeId("row"), label: "Guest Name", valueTemplate: "{{guest_name}}", visible: true },
          { id: makeId("row"), label: "Room", valueTemplate: "{{room_name}}", visible: true },
          {
            id: makeId("row"),
            label: "Check-In",
            valueTemplate: "{{check_in_date}}",
            visible: true,
          },
          {
            id: makeId("row"),
            label: "Check-Out",
            valueTemplate: "{{check_out_date}}",
            visible: true,
          },
        ],
      };
    case "two_column_text":
      return {
        id,
        type: "two_column_text",
        leftTitle: "Check-In",
        leftText: "{{check_in_date}} {{check_in_time}}",
        rightTitle: "Check-Out",
        rightText: "{{check_out_date}} {{check_out_time}}",
      };
    case "social_links":
      return {
        id,
        type: "social_links",
        title: "Connect with us",
        align: "left",
        links: [{ id: makeId("soc"), label: "Website", url: "{{hotel_website}}" }],
      };
    case "footer":
      return {
        id,
        type: "footer",
        showContactBlock: true,
        contactTitle: "{{hotel_name}} Contact",
        fields: [
          {
            id: makeId("cf"),
            key: "address",
            label: "Address",
            valueTemplate: "{{hotel_address}}",
            visible: true,
          },
          {
            id: makeId("cf"),
            key: "phone",
            label: "Phone",
            valueTemplate: "{{hotel_phone}}",
            visible: true,
          },
          {
            id: makeId("cf"),
            key: "email",
            label: "Email",
            valueTemplate: "{{hotel_email}}",
            visible: true,
          },
        ],
      };
    // 13 Modern Visual Blocks
    case "brand_header":
      return {
        id,
        type: "brand_header",
        showHotelName: true,
        showAddress: true,
        showPhone: true,
        iconTone: "muted",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 16, paddingX: 24 },
      };
    case "promo_banner":
      return {
        id,
        type: "promo_banner",
        imageUrl: buildPlaceholderImageUrl(appUrl, "business_banner"),
        imageAlt: "{{hotel_name}} guest portal",
        text: "Manage your upcoming stay and check-in preferences online.",
        buttonLabel: "Open Portal",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "outlined",
        buttonCorner: "pill",
        buttonTextColor: "#ffffff",
        style: { backgroundColor: "#18181b", textColor: "#ffffff", paddingY: 14, paddingX: 24 },
      };
    case "membership_strip":
      return {
        id,
        type: "membership_strip",
        condition: "has_loyalty",
        tierTemplate: "{{loyalty_tier}} Member",
        pointsTemplate: "{{loyalty_points_balance}} Points",
        style: {
          backgroundColor: "#f8fafc",
          textColor: "#334155",
          borderColor: "#e2e8f0",
          paddingY: 10,
          paddingX: 24,
        },
      };
    case "icon_divider":
      return {
        id,
        type: "icon_divider",
        icon: "calendar",
        iconTone: "muted",
        lineColor: "#e4e4e7",
        style: { paddingY: 14, paddingX: 24 },
      };
    case "hero_text":
      return {
        id,
        type: "hero_text",
        headline: "We Look Forward to Welcoming You",
        body: "Dear {{guest_name}}, your reservation at {{hotel_name}} is confirmed.",
        buttonLabel: "Manage Stay",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "outlined",
        buttonCorner: "square",
        style: {
          backgroundColor: "#ffffff",
          textColor: "#18181b",
          align: "center",
          paddingY: 20,
          paddingX: 28,
        },
      };
    case "confirmation_number":
      return {
        id,
        type: "confirmation_number",
        label: "CONFIRMATION NUMBER",
        valueTemplate: "{{booking_reference}}",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 16, paddingX: 24 },
      };
    case "stay_dates":
      return {
        id,
        type: "stay_dates",
        checkInLabel: "CHECK-IN",
        checkInDateTemplate: "{{check_in_date}}",
        checkInTimeTemplate: "{{check_in_time}}",
        checkOutLabel: "CHECK-OUT",
        checkOutDateTemplate: "{{check_out_date}}",
        checkOutTimeTemplate: "{{check_out_time}}",
        style: {
          backgroundColor: "#ffffff",
          textColor: "#18181b",
          borderColor: "#d4d4d8",
          paddingY: 16,
          paddingX: 24,
        },
      };
    case "feature_card":
      return {
        id,
        type: "feature_card",
        imagePosition: "left",
        imageUrl: buildPlaceholderImageUrl(appUrl, "coastal_card"),
        imageAlt: "{{hotel_name}} highlight",
        title: "Elevate Your Stay",
        body: "Discover dining, wellness, and curated experiences available during your visit.",
        buttonLabel: "Explore Options",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "filled",
        buttonCorner: "rounded",
        style: {
          backgroundColor: "#ffffff",
          borderColor: "#e4e4e7",
          borderRadius: 12,
          paddingY: 10,
          paddingX: 24,
        },
      };
    case "benefits_list":
      return {
        id,
        type: "benefits_list",
        condition: "has_loyalty",
        badgeText: "{{loyalty_tier}}",
        heading: "Enjoy your {{loyalty_tier}} benefits during your stay",
        listStyle: "bullet",
        itemIcon: "check",
        iconTone: "emerald",
        items: [
          { id: makeId("ben"), text: "Complimentary high-speed Wi-Fi throughout the property" },
          { id: makeId("ben"), text: "Priority room preferences subject to availability" },
          { id: makeId("ben"), text: "Current points balance: {{loyalty_points_balance}}" },
        ],
        footnote: "*Select benefits are subject to availability at check-in.",
        buttonLabel: "View Member Details",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "outlined",
        buttonCorner: "square",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 18, paddingX: 28 },
      };
    case "icon_link_grid":
      return {
        id,
        type: "icon_link_grid",
        heading: "Explore the Property",
        subheading: "Helpful services and inspiration for your upcoming visit.",
        iconTone: "dark",
        items: [
          { id: makeId("ig"), icon: "dining", label: "Hotel Dining", url: "{{hotel_website}}" },
          { id: makeId("ig"), icon: "spa", label: "Wellness & Spa", url: "{{hotel_website}}" },
          { id: makeId("ig"), icon: "map", label: "Local Guide", url: "{{hotel_website}}" },
        ],
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 20, paddingX: 24 },
      };
    case "image_with_list":
      return {
        id,
        type: "image_with_list",
        imagePosition: "left",
        imageUrl: buildPlaceholderImageUrl(appUrl, "suite_card"),
        imageAlt: "{{hotel_name}} guest portal features",
        heading: "Everything ready before you arrive",
        iconTone: "dark",
        items: [
          { id: makeId("iwl"), icon: "key", text: "Review your check-in and room details" },
          { id: makeId("iwl"), icon: "wifi", text: "Access property amenities and Wi-Fi info" },
          { id: makeId("iwl"), icon: "chat", text: "Reach our front desk team anytime" },
        ],
        buttonLabel: "Go to Portal",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "dark",
        buttonCorner: "square",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 18, paddingX: 24 },
      };
    case "footer_nav":
      return {
        id,
        type: "footer_nav",
        links: [
          { id: makeId("fn"), label: "Hotel Website", url: "{{hotel_website}}" },
          { id: makeId("fn"), label: "Manage Booking", url: "{{portal_link}}" },
        ],
        style: {
          backgroundColor: "#ffffff",
          textColor: "#3f3f46",
          borderColor: "#e4e4e7",
          paddingY: 16,
          paddingX: 24,
        },
      };
    case "legal_section":
      return {
        id,
        type: "legal_section",
        sections: [
          {
            id: makeId("lg"),
            heading: "Contact Us",
            body: "For questions regarding reservation {{booking_reference}}, contact {{hotel_name}} at {{hotel_phone}} or {{hotel_email}}.",
          },
          {
            id: makeId("lg"),
            heading: "Reservation Notice",
            body: "This transactional confirmation was generated for your stay at {{hotel_name}} ({{hotel_address}}).",
          },
        ],
        copyrightText: "© {{hotel_name}}",
        style: { backgroundColor: "#ffffff", textColor: "#52525b", paddingY: 16, paddingX: 24 },
      };
  }
}

export function summarizeEmailBlock(block: EmailBlock): string {
  switch (block.type) {
    case "heading":
      return block.text;
    case "paragraph":
      return block.text;
    case "image":
      return block.alt || block.src || "No image selected";
    case "button":
      return `${block.label} → ${block.url}`;
    case "divider":
      return `${block.thicknessPx || 1}px line`;
    case "spacer":
      return `${block.heightPx || 16}px vertical space`;
    case "booking_details_table":
      return `${block.title || "Summary"} (${block.rows.filter((r) => r.visible).length} rows)`;
    case "two_column_text":
      return `${block.leftTitle} / ${block.rightTitle}`;
    case "social_links":
      return `${block.links.length} link(s)`;
    case "footer":
      return block.contactTitle || "Contact & Imprint";
    case "brand_header":
      return (
        [
          block.showHotelName ? "Hotel Name" : "",
          block.showAddress ? "Address" : "",
          block.showPhone ? "Phone" : "",
        ]
          .filter(Boolean)
          .join(" · ") || "Logo header"
      );
    case "promo_banner":
      return block.text || "Promo banner";
    case "membership_strip":
      return `${block.tierTemplate} | ${block.pointsTemplate}`;
    case "icon_divider":
      return `Centered ${block.icon.replace("_", " ")} icon`;
    case "hero_text":
      return block.headline;
    case "confirmation_number":
      return `${block.label}: ${block.valueTemplate}`;
    case "stay_dates":
      return `${block.checkInLabel} → ${block.checkOutLabel}`;
    case "feature_card":
      return `${block.title} (image ${block.imagePosition})`;
    case "benefits_list":
      return `${block.heading} (${block.items.length} items)`;
    case "icon_link_grid":
      return `${block.heading || "Icon links"} (${block.items.length} items)`;
    case "image_with_list":
      return `${block.heading} (${block.items.length} items)`;
    case "footer_nav":
      return block.links.map((l) => l.label).join(" · ");
    case "legal_section":
      return `${block.sections.length} notice section(s)`;
  }
}

export function applyImageAssetToEmailBlock(
  block: EmailBlock,
  field: string,
  img: EmailImageAsset
): EmailBlock {
  if (block.type === "image" && field === "src") {
    return {
      ...block,
      imageId: img.id,
      src: img.url,
      alt: !block.alt || block.alt === "{{hotel_name}} image" ? img.label : block.alt,
    };
  }
  if (block.type === "brand_header" && field === "logoUrl") {
    return {
      ...block,
      logoImageId: img.id,
      logoUrl: img.url,
      logoAlt: block.logoAlt || img.label || "{{hotel_name}}",
    };
  }
  if (block.type === "promo_banner" && field === "imageUrl") {
    return {
      ...block,
      imageId: img.id,
      imageUrl: img.url,
      imageAlt: block.imageAlt || img.label,
    };
  }
  if (block.type === "feature_card" && field === "imageUrl") {
    return {
      ...block,
      imageId: img.id,
      imageUrl: img.url,
      imageAlt: block.imageAlt || img.label,
    };
  }
  if (block.type === "image_with_list" && field === "imageUrl") {
    return {
      ...block,
      imageId: img.id,
      imageUrl: img.url,
      imageAlt: block.imageAlt || img.label,
    };
  }
  if (block.type === "legal_section" && field === "footerLogoUrl") {
    return {
      ...block,
      footerLogoImageId: img.id,
      footerLogoUrl: img.url,
      footerLogoAlt: block.footerLogoAlt || img.label || "{{hotel_name}}",
    };
  }
  if (block.type === "benefits_list" && field === "badgeImageUrl") {
    return {
      ...block,
      badgeImageId: img.id,
      badgeImageUrl: img.url,
      badgeImageAlt: block.badgeImageAlt || img.label,
    };
  }
  return block;
}

const QUICK_PALETTE_BLOCKS: readonly EmailBlockType[] = [
  "brand_header",
  "promo_banner",
  "hero_text",
  "confirmation_number",
  "stay_dates",
  "feature_card",
  "benefits_list",
  "icon_link_grid",
  "image_with_list",
  "footer_nav",
  "legal_section",
];

export interface BlockEditorProps {
  blocks: EmailBlock[];
  appUrl: string;
  resolvedPortalUrl: string;
  validationIssues: ValidationIssue[];
  expandedBlockId: string | null;
  onExpandBlock: (blockId: string | null) => void;
  onAddBlock: (type: EmailBlockType) => void;
  onAddOptionalSection: (presetId: string) => void;
  onUpdateBlock: (blockId: string, updater: (b: EmailBlock) => EmailBlock) => void;
  onMoveBlock: (index: number, delta: -1 | 1) => void;
  onReorderBlock: (fromIndex: number, toIndex: number) => void;
  onDuplicateBlock: (index: number) => void;
  onRemoveBlock: (blockId: string) => void;
  imageActions: ImageActionCallbacks;
}

export function BlockEditor({
  blocks,
  appUrl,
  resolvedPortalUrl,
  validationIssues,
  expandedBlockId,
  onExpandBlock,
  onAddBlock,
  onAddOptionalSection,
  onUpdateBlock,
  onMoveBlock,
  onReorderBlock,
  onDuplicateBlock,
  onRemoveBlock,
  imageActions,
}: BlockEditorProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickPaletteOpen, setQuickPaletteOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<BlockSectionGroup>("all");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const groupCounts = useMemo(() => {
    const counts: Record<BlockSectionGroup, number> = {
      all: blocks.length,
      header: 0,
      content: 0,
      cards: 0,
      footer: 0,
    };
    for (const b of blocks) {
      counts[getBlockSectionGroup(b.type)] += 1;
    }
    return counts;
  }, [blocks]);

  const inputClass =
    "w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors";

  return (
    <div className="space-y-3">
      {/* Header + Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
            Email Content Blocks ({blocks.length})
          </h3>
          <span className="text-[11px] text-zinc-500">
            Drag blocks to reorder across groups
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setQuickPaletteOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
              quickPaletteOpen
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
            }`}
          >
            <Layers size={13} /> Visual Palette
          </button>

          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                onAddOptionalSection(e.target.value);
                e.target.value = "";
              }
            }}
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="" disabled>
              + Quick Section...
            </option>
            {OPTIONAL_SECTION_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white whitespace-nowrap"
          >
            <Plus size={13} /> Add Block
          </button>
        </div>
      </div>

      {/* Inline Visual Block Palette Drawer */}
      {quickPaletteOpen && (
        <div className="rounded-xl bg-zinc-950/90 border border-zinc-800 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-zinc-300">
              Quick Insert Modern Blocks
            </span>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
            >
              Browse All {BLOCK_CATALOG.length} Blocks →
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {QUICK_PALETTE_BLOCKS.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onAddBlock(type)}
                className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-emerald-500/50 text-left text-[11px] text-zinc-200 transition-colors"
              >
                <span className="truncate">{BLOCK_TYPE_LABELS[type]}</span>
                <Plus size={11} className="text-emerald-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Section Group Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {(Object.keys(SECTION_GROUP_LABELS) as BlockSectionGroup[]).map((group) => {
          const active = activeGroup === group;
          return (
            <button
              key={group}
              type="button"
              onClick={() => setActiveGroup(group)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors tabular-nums ${
                active
                  ? "bg-zinc-800 text-zinc-100 border border-zinc-700"
                  : "bg-zinc-950 text-zinc-500 hover:text-zinc-300 border border-zinc-800/80"
              }`}
            >
              {SECTION_GROUP_LABELS[group]} ({groupCounts[group]})
            </button>
          );
        })}
      </div>

      {/* Grouped / Reorderable Block Cards */}
      <div className="space-y-2">
        {blocks.map((block, idx) => {
          const group = getBlockSectionGroup(block.type);
          if (activeGroup !== "all" && group !== activeGroup) {
            return null;
          }

          const blockHasError = validationIssues.some((i) =>
            i.path.startsWith(`blocks[${idx}]`)
          );
          const isExpanded = expandedBlockId === block.id || blockHasError;
          const isDragTarget =
            dragOverIndex === idx && dragIndex !== null && dragIndex !== idx;
          const prevBlock = idx > 0 ? blocks[idx - 1] : null;
          const showGroupDivider =
            activeGroup === "all" &&
            (!prevBlock || getBlockSectionGroup(prevBlock.type) !== group);

          return (
            <React.Fragment key={block.id}>
              {showGroupDivider && (
                <div className="pt-1 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    {SECTION_GROUP_LABELS[group]}
                  </span>
                  <div className="h-px flex-1 bg-zinc-800/80" />
                </div>
              )}

              <div
                draggable
                onDragStart={(e) => {
                  setDragIndex(idx);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverIndex !== idx) setDragOverIndex(idx);
                }}
                onDragLeave={() => {
                  if (dragOverIndex === idx) setDragOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) onReorderBlock(dragIndex, idx);
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                className={`rounded-xl bg-zinc-900/60 border transition-colors ${
                  isDragTarget
                    ? "border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/40"
                    : blockHasError
                    ? "border-red-500/60"
                    : isExpanded
                    ? "border-zinc-700"
                    : "border-zinc-800 hover:border-zinc-700"
                }`}
              >
                {/* Block Card Header */}
                <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 shrink-0"
                      title="Drag to reorder block"
                    >
                      <GripVertical size={14} />
                    </span>

                    <button
                      type="button"
                      onClick={() => onExpandBlock(isExpanded ? null : block.id)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} className="text-zinc-400 shrink-0" />
                      ) : (
                        <ChevronRight size={14} className="text-zinc-500 shrink-0" />
                      )}
                      <span className="text-[11px] font-mono text-zinc-500 tabular-nums shrink-0">
                        #{idx + 1}
                      </span>
                      <span className="text-xs font-semibold text-zinc-200 whitespace-nowrap">
                        {BLOCK_TYPE_LABELS[block.type] || block.type}
                      </span>
                      <span className="hidden md:inline text-[10px] text-zinc-500 border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 rounded shrink-0">
                        {SECTION_GROUP_BADGE[group]}
                      </span>
                      {!isExpanded && (
                        <span className="text-[11px] text-zinc-500 truncate">
                          — {summarizeEmailBlock(block)}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      value={block.condition || "always"}
                      onChange={(e) =>
                        onUpdateBlock(block.id, (b) => ({
                          ...b,
                          condition: e.target.value as BlockCondition,
                        }))
                      }
                      aria-label="Block visibility condition"
                      className="hidden sm:block rounded bg-zinc-950 border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400 focus:outline-none focus:border-emerald-500 max-w-[140px]"
                    >
                      {(Object.keys(CONDITION_LABELS) as BlockCondition[]).map((c) => (
                        <option key={c} value={c}>
                          {CONDITION_LABELS[c]}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onMoveBlock(idx, -1)}
                      className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      aria-label="Move block up"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === blocks.length - 1}
                      onClick={() => onMoveBlock(idx, 1)}
                      className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      aria-label="Move block down"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicateBlock(idx)}
                      className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                      title="Duplicate block"
                      aria-label="Duplicate block"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveBlock(block.id)}
                      className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                      aria-label="Delete block"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Expanded Per-Block Configuration Panel (Colors, Spacing, Border-Radius, Icons, Links) */}
                {isExpanded && (
                  <div className="px-3.5 pb-3.5 pt-2 border-t border-zinc-800/80 space-y-2.5">
                    <div className="sm:hidden">
                      <label className="block text-[11px] text-zinc-400 mb-1">Visibility</label>
                      <select
                        value={block.condition || "always"}
                        onChange={(e) =>
                          onUpdateBlock(block.id, (b) => ({
                            ...b,
                            condition: e.target.value as BlockCondition,
                          }))
                        }
                        className={inputClass}
                      >
                        {(Object.keys(CONDITION_LABELS) as BlockCondition[]).map((c) => (
                          <option key={c} value={c}>
                            {CONDITION_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <BlockInspector
                      block={block}
                      appUrl={appUrl}
                      resolvedPortalUrl={resolvedPortalUrl}
                      onChange={(updater) => onUpdateBlock(block.id, updater)}
                      imageActions={imageActions}
                    />
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Bottom Add Block Trigger */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="w-full py-3 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/70 border border-dashed border-zinc-800 hover:border-emerald-500/50 text-xs font-medium text-zinc-300 hover:text-emerald-300 transition-colors inline-flex items-center justify-center gap-1.5"
      >
        <Plus size={14} /> Add Content Block (Header, Promo, Hero, Stay Dates, Feature Cards,
        Icons, Footer...)
      </button>

      {/* Full Categorized Block Palette Modal */}
      {paletteOpen && (
        <BlockPaletteModal
          onSelect={(type) => onAddBlock(type)}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
