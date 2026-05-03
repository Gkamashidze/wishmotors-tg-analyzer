export interface ProductSale {
  id: number;
  quantity: number;
  unitPrice: number;
  paymentMethod: string;
  customerName: string | null;
  soldAt: string;
  notes: string | null;
  topicId: number | null;
  topicMessageId: number | null;
}

export interface ProductOrder {
  id: number;
  quantityNeeded: number;
  status: string;
  priority: string;
  createdAt: string;
  notes: string | null;
  topicId: number | null;
  topicMessageId: number | null;
}

export interface SaleEditState {
  quantity: string;
  unit_price: string;
  payment_method: string;
  customer_name: string;
  sold_at: string;
  notes: string;
}

export interface OrderEditState {
  quantity_needed: string;
  status: string;
  priority: string;
  notes: string;
}

export interface NewCompatState {
  model: string;
  drive: string;
  engine: string;
  fuel_type: string;
  year_from: string;
  year_to: string;
}

export interface EditState {
  name: string;
  oem_code: string;
  unit_price: string;
  category: string;
  compatibility_notes: string;
  image_url: string;
  item_type: string;
  slug: string;
  description: string;
  is_published: boolean;
}

export interface AddState {
  name: string;
  oem_code: string;
  unit: string;
  unit_price: string;
  current_stock: string;
  min_stock: string;
}

export type WizardStep = 1 | 2 | 3 | 4;
export type TxTab = "info" | "sales" | "orders";
