"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { requireCsrfToken } from "@/features/auth/hooks";
import { ProductImage } from "@/features/catalog/ProductImage";
import type { Product } from "@/features/catalog/product";
import {
  createProduct,
  EMPTY_PRODUCT_FORM,
  productToForm,
  updateProduct,
  validateProductForm,
  type ProductForm,
  type ProductFormErrors,
} from "./api";

interface FieldSpec {
  name: keyof ProductForm;
  label: string;
  hint?: string;
  multiline?: boolean;
  inputMode?: "decimal" | "numeric";
  wide?: boolean;
}

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Product name" },
  { name: "category", label: "Category" },
  { name: "price", label: "Price (USD)", hint: "For example 19.99.", inputMode: "decimal" },
  { name: "stock", label: "Stock", hint: "Whole number. Only enforced for products with tracked inventory.", inputMode: "numeric" },
  { name: "image", label: "Image path", hint: "images/products/file-name.jpg (an image in the store), or an https address.", wide: true },
  { name: "description", label: "About this product", multiline: true, wide: true },
  { name: "howItWorks", label: "How it works", multiline: true, wide: true },
  { name: "careInstructions", label: "Care and guidance", multiline: true, wide: true },
  { name: "highlights", label: "Highlights", hint: "Separate with commas.", wide: true },
  { name: "keywords", label: "Search keywords (optional)", hint: "Separate with commas. Shoppers find the product by these words. Left empty on a new product, the category is used.", wide: true },
];

const inputClass = "mt-1 w-full rounded-md border border-slate-400 px-3 py-2 font-normal aria-[invalid=true]:border-red-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#198754]";

/** Create (no product) or edit a product. */
export function ProductFormClient({ product }: { product?: Product }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formId = useId();
  const [form, setForm] = useState<ProductForm>(() => (product ? productToForm(product) : EMPTY_PRODUCT_FORM));
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const summary = useRef<HTMLDivElement>(null);
  const editing = Boolean(product);

  const save = useMutation({
    mutationKey: ["admin", editing ? "update-product" : "create-product"],
    mutationFn: async (values: ProductForm) => {
      const csrfToken = await requireCsrfToken(queryClient);
      return product ? updateProduct(product.id, values, csrfToken) : createProduct(values, csrfToken);
    },
    onSuccess: (saved) => {
      router.push(`/admin/products?${new URLSearchParams({ saved: editing ? "updated" : "created", name: saved.name })}`);
      router.refresh();
    },
    onError: () => summary.current?.focus(),
  });

  const change = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const name = event.currentTarget.name as keyof ProductForm;
    const { value } = event.currentTarget;
    setForm((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateProductForm(form);
    setErrors(found);
    const first = FIELDS.find((field) => found[field.name]);
    if (first) {
      document.getElementById(`${formId}-${first.name}`)?.focus();
      return;
    }
    save.mutate(form);
  };

  const errorCount = Object.values(errors).filter(Boolean).length;

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 rounded-lg border bg-white p-4 shadow-sm sm:p-6" aria-describedby={errorCount ? `${formId}-summary` : undefined}>
      <div ref={summary} tabIndex={-1} id={`${formId}-summary`} className="outline-none">
        {errorCount > 0 && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
            {errorCount === 1 ? "1 field needs attention." : `${errorCount} fields need attention.`} Each problem is described under its field.
          </p>
        )}
        {save.isError && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">{save.error.message}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {FIELDS.map((field) => {
          const id = `${formId}-${field.name}`;
          const describedBy = [field.hint ? `${id}-hint` : "", errors[field.name] ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
          const common = {
            id,
            name: field.name,
            value: form[field.name],
            onChange: change,
            "aria-invalid": errors[field.name] ? true : undefined,
            "aria-describedby": describedBy,
            className: inputClass,
          };
          return (
            <div key={field.name} className={field.wide ? "md:col-span-2" : undefined}>
              <label htmlFor={id} className="font-medium">{field.label}</label>
              {field.hint && <p id={`${id}-hint`} className="text-sm text-slate-600">{field.hint}</p>}
              {field.multiline
                ? <textarea {...common} rows={3} required />
                : <input {...common} type="text" inputMode={field.inputMode} required={field.name !== "keywords"} autoComplete="off" />}
              {errors[field.name] && <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-700">{errors[field.name]}</p>}
            </div>
          );
        })}
      </div>

      {form.image.trim() && (
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <ProductImage product={{ image: form.image, name: `Preview of ${form.name || "the product"}` }} sizes="96px" className="w-24" />
          <span>Image preview as shoppers will see it.</span>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link href="/admin/products" className="rounded border px-5 py-2 text-center font-semibold hover:bg-slate-50">Cancel</Link>
        <button type="submit" disabled={save.isPending} className="rounded bg-[#198754] px-5 py-2 font-semibold text-white hover:bg-[#126c45] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#198754] disabled:opacity-60">
          {save.isPending ? "Saving…" : editing ? "Save changes" : "Create product"}
        </button>
      </div>
    </form>
  );
}
