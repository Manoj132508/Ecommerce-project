import { useEffect, useState } from 'react';

const emptyForm = {
  name: '',
  price: '',
  description: '',
  image: '',
  category: '',
  stock: ''
};

/** Converts a stored product into the string values expected by HTML inputs. */
function productToFormData(product) {
  if (!product) return emptyForm;

  return {
    name: product.name || '',
    price: (product.priceCents / 100).toFixed(2),
    description: product.description || '',
    image: product.image || '',
    category: product.category || '',
    stock: String(product.stock ?? 0)
  };
}

/**
 * Renders the shared create/edit form.
 * Passing an editingProduct switches the form into update mode automatically.
 */
export function ProductForm({ editingProduct, saving, onCreate, onUpdate, onCancel }) {
  const [formData, setFormData] = useState(emptyForm);

  /** Synchronizes the input values whenever the administrator selects another product. */
  useEffect(() => {
    setFormData(productToFormData(editingProduct));
  }, [editingProduct]);

  /** Updates one controlled input while preserving all other form values. */
  const handleInputChange = (event) => {
    setFormData((current) => ({
      ...current,
      [event.target.name]: event.target.value
    }));
  };

  /** Sends the form to either the create or update action and resets it on success. */
  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      if (editingProduct) {
        await onUpdate(editingProduct.id, formData);
      } else {
        await onCreate(formData);
        setFormData(emptyForm);
      }
    } catch {
      // The dashboard hook exposes the request error above the form.
    }
  };

  /** Leaves edit mode and clears the form fields. */
  const handleCancel = () => {
    setFormData(emptyForm);
    onCancel();
  };

  return (
    <section className="mb-8 rounded-lg bg-white p-6 shadow-md">
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
          <input type="text" name="description" value={formData.description} onChange={handleInputChange} placeholder="Description" className="rounded border px-3 py-2" required />
        </div>

        <div className="flex gap-2">
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
