"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describedBy, FieldError, FieldHint } from "@/features/auth/fields";
import { requireCsrfToken } from "@/features/auth/hooks";
import { ProductImage } from "@/features/catalog/ProductImage";
import type { Product } from "@/features/catalog/product";
import { cn } from "@/lib/utils";
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
  section: "basics" | "media" | "details" | "search";
}

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Product name", section: "basics" },
  { name: "category", label: "Category", section: "basics" },
  { name: "price", label: "Price (USD)", hint: "For example 19.99.", inputMode: "decimal", section: "basics" },
  { name: "stock", label: "Stock", hint: "Whole number. Only enforced for products with tracked inventory.", inputMode: "numeric", section: "basics" },
  { name: "image", label: "Image path", hint: "images/products/file-name.jpg (an image in the store), or an https address.", wide: true, section: "media" },
  { name: "description", label: "About this product", multiline: true, wide: true, section: "details" },
  { name: "howItWorks", label: "How it works", multiline: true, wide: true, section: "details" },
  { name: "careInstructions", label: "Care and guidance", multiline: true, wide: true, section: "details" },
  { name: "highlights", label: "Highlights", hint: "Separate with commas.", wide: true, section: "details" },
  { name: "keywords", label: "Search keywords (optional)", hint: "Separate with commas. Shoppers find the product by these words. Left empty on a new product, the category is used.", wide: true, section: "search" },
];

const SECTIONS: { id: FieldSpec["section"]; title: string; description: string }[] = [
  { id: "basics", title: "Basics", description: "Name, category, price and stock." },
  { id: "media", title: "Image", description: "The photo shown in the store." },
  { id: "details", title: "Product information", description: "Shown on the product page." },
  { id: "search", title: "Search", description: "How shoppers find the product." },
];

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
  const fieldId = (name: keyof ProductForm) => `${formId}-${name}`;

  const renderField = (field: FieldSpec) => {
    const id = fieldId(field.name);
    const common = {
      id,
      name: field.name,
      value: form[field.name],
      onChange: change,
      "aria-invalid": errors[field.name] ? true : undefined,
      "aria-describedby": describedBy(field.hint && `${id}-hint`, errors[field.name] && `${id}-error`),
    };
    return (
      <div key={field.name} className={cn("grid content-start gap-1.5", field.wide && "md:col-span-2")}>
        <Label htmlFor={id}>{field.label}</Label>
        {field.hint && <FieldHint id={`${id}-hint`}>{field.hint}</FieldHint>}
        {field.multiline
          ? <Textarea {...common} rows={3} required />
          : <Input {...common} type="text" inputMode={field.inputMode} required={field.name !== "keywords"} autoComplete="off" />}
        <FieldError id={`${id}-error`} message={errors[field.name]} />
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-6" aria-describedby={errorCount ? `${formId}-summary` : undefined}>
      <div ref={summary} tabIndex={-1} id={`${formId}-summary`} className="grid gap-3 outline-none">
        {errorCount > 0 && (
          <Alert role="alert" variant="destructive">
            <p className="font-semibold">{errorCount === 1 ? "1 field needs attention." : `${errorCount} fields need attention.`} Each problem is described under its field.</p>
            <ul className="mt-1 list-disc pl-5">
              {FIELDS.filter((field) => errors[field.name]).map((field) => (
                <li key={field.name}><a href={`#${fieldId(field.name)}`}>{field.label}: {errors[field.name]}</a></li>
              ))}
            </ul>
          </Alert>
        )}
        {save.isError && <Alert role="alert" variant="destructive">{save.error.message}</Alert>}
      </div>

      {SECTIONS.map((section) => (
        <Card key={section.id} className="grid gap-4 p-5 sm:p-6">
          <div className="grid gap-0.5">
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <p className="text-sm text-muted-foreground">{section.description}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">{FIELDS.filter((field) => field.section === section.id).map(renderField)}</div>
          {section.id === "media" && form.image.trim() && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <div className="w-24 rounded-sm bg-surface p-1.5">
                <ProductImage product={{ image: form.image, name: `Preview of ${form.name || "the product"}` }} sizes="96px" />
              </div>
              <span>Image preview as shoppers will see it.</span>
            </div>
          )}
        </Card>
      ))}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link href="/admin/products" className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button type="submit" size="lg" disabled={save.isPending} aria-busy={save.isPending || undefined}>
          {save.isPending ? "Saving…" : editing ? "Save changes" : "Create product"}
        </Button>
      </div>
    </form>
  );
}
