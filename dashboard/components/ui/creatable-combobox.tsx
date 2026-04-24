"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface CreatableComboboxProps {
  id?: string;
  label?: string;
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  onCreateOption?: (inputValue: string) => Promise<ComboOption> | ComboOption;
  onAddNew?: (inputValue: string) => void;
  addNewLabel?: string;
  placeholder?: string;
  createLabel?: string;
  disabled?: boolean;
}

export function CreatableCombobox({
  id,
  label,
  options,
  value,
  onChange,
  onCreateOption,
  onAddNew,
  addNewLabel = "+ ახალი პროდუქტის დამატება",
  placeholder = "პროდუქტი...",
  createLabel = "შექმნა",
  disabled = false,
}: CreatableComboboxProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;

  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);
  const displayValue = focused ? inputValue : (selectedOption?.label ?? "");

  const filtered = inputValue.trim()
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(inputValue.toLowerCase()) ||
          (o.sublabel ?? "").toLowerCase().includes(inputValue.toLowerCase()),
      )
    : options;

  const exactMatch = options.some(
    (o) => o.label.toLowerCase() === inputValue.trim().toLowerCase(),
  );

  const showCreate = !!onCreateOption && inputValue.trim().length > 1 && !exactMatch;
  const hasResults = filtered.length > 0 || showCreate || !!onAddNew;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !inputWrapRef.current) return;
    const rect = inputWrapRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, [open]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const inContainer = containerRef.current?.contains(e.target as Node);
      const inDropdown = dropdownRef.current?.contains(e.target as Node);
      if (!inContainer && !inDropdown) {
        setOpen(false);
        setFocused(false);
        setInputValue("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleFocus() {
    setFocused(true);
    setInputValue(selectedOption?.label ?? "");
    setOpen(true);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
    setOpen(true);
  }

  function handleSelect(option: ComboOption) {
    onChange(option.value);
    setOpen(false);
    setFocused(false);
    setInputValue("");
  }

  async function handleCreate() {
    if (!onCreateOption || !inputValue.trim()) return;
    setCreating(true);
    try {
      const result = await onCreateOption(inputValue.trim());
      onChange(result.value);
      setOpen(false);
      setFocused(false);
      setInputValue("");
    } finally {
      setCreating(false);
    }
  }

  const dropdown = open && hasResults && mounted ? (
    <div ref={dropdownRef} style={dropdownStyle} className="rounded-lg border border-border bg-popover shadow-lg">
      <ul className="max-h-52 overflow-y-auto py-1" role="listbox" aria-label="პროდუქტის სია">
        {filtered.map((o) => (
          <li
            key={o.value}
            role="option"
            aria-selected={o.value === value}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground select-none",
              o.value === value && "bg-accent/40",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              handleSelect(o);
            }}
          >
            <Check
              className={cn("h-3.5 w-3.5 shrink-0", o.value === value ? "opacity-100 text-primary" : "opacity-0")}
            />
            <div className="flex flex-col min-w-0">
              <span className="truncate">{o.label}</span>
              {o.sublabel && (
                <span className="text-xs text-muted-foreground font-mono truncate">{o.sublabel}</span>
              )}
            </div>
          </li>
        ))}

        {showCreate && (
          <li
            role="option"
            aria-selected={false}
            className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground border-t border-border select-none"
            onMouseDown={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              <span className="text-muted-foreground">{createLabel}: </span>
              <span className="font-medium">"{inputValue.trim()}"</span>
            </span>
            {creating && <span className="ml-auto text-xs text-muted-foreground animate-pulse">ინახება...</span>}
          </li>
        )}

        {onAddNew && (
          <li
            role="option"
            aria-selected={false}
            className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground border-t border-border select-none"
            onMouseDown={(e) => {
              e.preventDefault();
              const typed = inputValue.trim();
              setOpen(false);
              setFocused(false);
              setInputValue("");
              onAddNew(typed);
            }}
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-primary font-medium">{addNewLabel}</span>
          </li>
        )}
      </ul>
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-1.5" ref={containerRef}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium">
          {label}
        </label>
      )}
      <div className="relative" ref={inputWrapRef}>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          disabled={disabled || creating}
          placeholder={placeholder}
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          className="h-9 w-full rounded-lg border border-input bg-background px-3 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="სიის გახსნა"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
          onClick={() => {
            if (open) {
              setOpen(false);
              setFocused(false);
              setInputValue("");
            } else {
              setFocused(true);
              setInputValue(selectedOption?.label ?? "");
              setOpen(true);
            }
          }}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-150", open && "rotate-180")} />
        </button>
      </div>

      {mounted && createPortal(dropdown, document.body)}
    </div>
  );
}
