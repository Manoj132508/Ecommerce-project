import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ProductData, ProductFormData } from '../../types/product';
import { useAdminProductsContext } from './AdminProductsContext';

const emptyForm: ProductFormData = {
  name: '',
  price: '',
  description: '',
  howItWorks: '',
  highlights: '',
  careInstructions: '',
  image: '',
  category: '',
  stock: '',
};

/** Converts a stored product into the string values expected by HTML inputs. */
function productToFormData(product: ProductData | null): ProductFormData {
  if (!product) return emptyForm;

  return {
    name: product.name || '',
    price: (product.priceCents / 100).toFixed(2),
    description: product.description || '',
    howItWorks: product.howItWorks || '',
    highlights: product.highlights?.join(', ') || '',
    careInstructions: product.careInstructions || '',
    image: product.image || '',
    category: product.category || '',
    stock: String(product.stock ?? 0),
  };
}

/**
 * Renders the shared create/edit form.
 * The Admin Products context switches the form into update mode automatically.
 */
export function ProductForm() {
  const {
    editingProduct,
    saving,
    createProduct,
    updateProduct,
    cancelEditing,
  } = useAdminProductsContext();
  const [formData, setFormData] = useState<ProductFormData>(emptyForm);

  /** Synchronizes the input values whenever the administrator selects another product. */
  useEffect(() => {
    setFormData(productToFormData(editingProduct));
  }, [editingProduct]);

  /** Updates one controlled input while preserving all other form values. */
  const handleInputChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const fieldName = event.target.name as keyof ProductFormData;
    setFormData((current) => ({
      ...current,
      [fieldName]: event.target.value,
    }));
  };

  /** Sends the form to either the create or update action and resets it on success. */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, formData);
      } else {
        await createProduct(formData);
        setFormData(emptyForm);
      }
    } catch {
      // The dashboard hook exposes the request error above the form.
    }
  };

  /** Leaves edit mode and clears the form fields. */
  const handleCancel = () => {
    setFormData(emptyForm);
    cancelEditing();
  };

  return (
    <section className="mb-8 rounded-lg bg-white p-4 shadow-md sm:p-6">
      <h2 className="mb-4 text-xl font-bold">
        {editingProduct ? 'Edit Product' : 'Add New Product'}
      </h2>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="Product Name" className="rounded border px-3 py-2" required />
          <input type="number" name="price" value={formData.price} onChange={handleInputChange} placeholder="Price" min="0" step="0.01" className="rounded border px-3 py-2" required />
          <input type="text" name="category" value={formData.category} onChange={handleInputChange} placeholder="Category" className="rounded border px-3 py-2" required />
          <input type="number" name="stock" value={formData.stock} onChange={handleInputChange} placeholder="Stock" min="0" step="1" className="rounded border px-3 py-2" required />
          <input type="text" name="image" value={formData.image} onChange={handleInputChange} placeholder="Image URL or /images/products/file.jpg" className="rounded border px-3 py-2" required />
        </div>

        <textarea name="description" value={formData.description} onChange={handleInputChange} placeholder="About this product" rows={4} className="w-full rounded border px-3 py-2" required />
        <textarea name="howItWorks" value={formData.howItWorks} onChange={handleInputChange} placeholder="How it works" rows={4} className="w-full rounded border px-3 py-2" required />
        <input type="text" name="highlights" value={formData.highlights} onChange={handleInputChange} placeholder="Highlights separated by commas" className="w-full rounded border px-3 py-2" required />
        <textarea name="careInstructions" value={formData.careInstructions} onChange={handleInputChange} placeholder="Care and guidance" rows={4} className="w-full rounded border px-3 py-2" required />

        <div className="flex flex-col gap-2 min-[400px]:flex-row">
          <button type="submit" disabled={saving} className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400">
            {saving
              ? (editingProduct ? 'Updating...' : 'Adding...')
              : (editingProduct ? 'Update Product' : 'Add Product')}
          </button>
          {editingProduct && (
            <button type="button" onClick={handleCancel} disabled={saving} className="rounded border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50">
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
