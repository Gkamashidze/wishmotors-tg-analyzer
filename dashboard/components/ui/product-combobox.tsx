"use client";

import { useMemo, useState, useCallback } from "react";
import { CreatableCombobox } from "@/components/ui/creatable-combobox";
import { AddProductModal, type NewProduct } from "@/components/dashboard/add-product-modal";
import type { ProductRow } from "@/lib/queries";

interface ProductComboboxProps {
  products: ProductRow[];
  value: string;
  onChange: (value: string) => void;
  onProductAdded?: (product: ProductRow) => void;
  onNewOem?: (oem: string) => void;
  id?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function ProductCombobox({
  products,
  value,
  onChange,
  onProductAdded,
  onNewOem,
  id,
  label,
  placeholder = "პროდუქტი...",
  disabled = false,
}: ProductComboboxProps) {
  const [showAddModal, setShowAddModal] = useState(false);

  const options = useMemo(
    () => [
      { value: "", label: "— პროდუქტი არ არის —" },
      ...products.map((p) => ({
        value: String(p.id),
        label: p.name,
        sublabel: p.oemCode ?? undefined,
      })),
    ],
    [products],
  );

  const handleProductAdded = useCallback(
    (newProduct: NewProduct) => {
      const row: ProductRow = {
        id: newProduct.id,
        name: newProduct.name,
        oemCode: newProduct.oemCode,
        currentStock: newProduct.currentStock,
        minStock: newProduct.minStock,
        unitPrice: newProduct.unitPrice,
        unit: newProduct.unit,
        category: null,
        compatibilityNotes: null,
        createdAt: newProduct.createdAt,
      };
      onProductAdded?.(row);
      onChange(String(newProduct.id));
    },
    [onChange, onProductAdded],
  );

  return (
    <>
      <CreatableCombobox
        id={id}
        label={label}
        options={options}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        onAddNew={(typed) => {
          if (onNewOem) {
            onNewOem(typed);
          } else {
            setShowAddModal(true);
          }
        }}
      />
      {!onNewOem && (
        <AddProductModal
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSuccess={handleProductAdded}
        />
      )}
    </>
  );
}
