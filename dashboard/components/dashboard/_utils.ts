import type { ProductRow } from "@/lib/queries";
import type {
  EditState, SaleEditState, OrderEditState,
  ProductSale, ProductOrder, WizardStep, AddState, NewCompatState,
} from "./_types";

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ka-GE", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function toDatetimeLocal(iso: string): string {
  return iso.slice(0, 16);
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "ხელზე 💵",
  transfer: "დარიცხვა 🏦",
  credit: "ნისია 📋",
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "⏳ მოლოდინი",
  completed: "✅ შესრულდა",
};

export const PRIORITY_LABELS: Record<string, string> = {
  urgent: "🔴 სასწრაფო",
  normal: "🟡 ჩვეულებრივი",
  low: "🟢 დაბალი",
};

export const CATALOG_FIELDS: { key: string; emoji: string; label: string }[] = [
  { key: "photo",         emoji: "📷", label: "ფოტო" },
  { key: "slug",          emoji: "🔗", label: "Slug" },
  { key: "description",   emoji: "📝", label: "აღწერა" },
  { key: "oem",           emoji: "🏷️",  label: "OEM კოდი" },
  { key: "category",      emoji: "📂", label: "კატეგორია" },
  { key: "compatibility", emoji: "🚗", label: "თავსებადობა" },
];

export function getCatalogCompletion(r: ProductRow) {
  return [
    { ...CATALOG_FIELDS[0], done: !!r.imageUrl },
    { ...CATALOG_FIELDS[1], done: !!r.slug },
    { ...CATALOG_FIELDS[2], done: !!r.description },
    { ...CATALOG_FIELDS[3], done: !!r.oemCode },
    { ...CATALOG_FIELDS[4], done: !!r.category },
    { ...CATALOG_FIELDS[5], done: r.compatCount > 0 },
  ];
}

export const ALL_MODELS_SENTINEL = "__ALL__";

export const SSANGYONG_MODELS = [
  "Korando Sport",
  "Korando C",
  "Rexton",
  "Turismo",
  "G4 Rexton",
  "Korando II",
  "Musso (GRAND)",
  "Tivoli",
] as const;

export const DRIVE_OPTIONS = ["წინა", "უკანა", "4x4"] as const;
export const FUEL_OPTIONS = ["ბენზინი", "დიზელი", "ჰიბრიდი"] as const;

export const DEFAULT_NEW_COMPAT: NewCompatState = {
  model: "", drive: "", engine: "", fuel_type: "", year_from: "", year_to: "",
};

export const GEO_LATIN: Record<string, string> = {
  ა: "a", ბ: "b", გ: "g", დ: "d", ე: "e", ვ: "v", ზ: "z",
  თ: "t", ი: "i", კ: "k", ლ: "l", მ: "m", ნ: "n", ო: "o",
  პ: "p", ჟ: "zh", რ: "r", ს: "s", ტ: "t", უ: "u", ფ: "f",
  ქ: "k", ღ: "gh", ყ: "k", შ: "sh", ჩ: "ch", ც: "ts", ძ: "dz",
  წ: "ts", ჭ: "ch", ხ: "kh", ჯ: "j", ჰ: "h",
};

export function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .split("")
    .map((c) => GEO_LATIN[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

export const WIZARD_STEPS: Record<WizardStep, string> = {
  1: "დასახელება",
  2: "OEM კოდი",
  3: "მარაგი",
  4: "ფასი",
};

export const DEFAULT_ADD: AddState = {
  name: "",
  oem_code: "",
  unit: "ცალი",
  unit_price: "0",
  current_stock: "0",
  min_stock: "0",
};

export const ITEM_TYPE_FILTERS = [
  { value: "",             label: "ყველა" },
  { value: "inventory",   label: "საქონელი" },
  { value: "fixed_asset", label: "ძირ. საშ." },
  { value: "consumable",  label: "სახარჯი" },
] as const;

export const PUBLISHED_FILTERS = [
  { value: "",  label: "ყველა" },
  { value: "1", label: "გამოქვეყნებული" },
  { value: "0", label: "გამოუქვეყნებელი" },
] as const;

export function rowToEdit(r: ProductRow, isPublished: boolean): EditState {
  return {
    name: r.name,
    oem_code: r.oemCode ?? "",
    unit_price: String(r.unitPrice),
    category: r.category ?? "",
    compatibility_notes: r.compatibilityNotes ?? "",
    image_url: r.imageUrl ?? "",
    item_type: r.itemType ?? "inventory",
    slug: r.slug ?? "",
    description: r.description ?? "",
    is_published: isPublished,
  };
}

export function saleToEdit(s: ProductSale): SaleEditState {
  return {
    quantity: String(s.quantity),
    unit_price: String(s.unitPrice),
    payment_method: s.paymentMethod,
    customer_name: s.customerName ?? "",
    sold_at: toDatetimeLocal(s.soldAt),
    notes: s.notes ?? "",
  };
}

export function orderToEdit(o: ProductOrder): OrderEditState {
  return {
    quantity_needed: String(o.quantityNeeded),
    status: o.status,
    priority: o.priority,
    notes: o.notes ?? "",
  };
}
