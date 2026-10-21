import type { RequestHandler } from "express";
import DeliveryOption from "../models/DeliveryOption.js";
import Product from "../models/Product.js";
import type { DeleteProductResponse, ErrorResponse } from "../types/api.js";
import { errorMessage, errorName } from "../utils/errors.js";

type NoParams = Record<string, string>;
type ProductParams = { productId: string };

// The admin product form posts strings; every field is validated before use.
interface ProductFormBody {
  name?: unknown;
  description?: unknown;
  howItWorks?: unknown;
  careInstructions?: unknown;
  image?: unknown;
  category?: unknown;
  price?: unknown;
  stock?: unknown;
  highlights?: unknown;
}

interface ProductDetails {
  name: string;
  description: string;
  howItWorks: string;
  highlights: string[];
  careInstructions: string;
  image: string;
  category: string;
  stock: number;
  priceCents: number;
  keywords: string[];
}

const getProductDetails = (body: ProductFormBody | undefined): ProductDetails | null => {
  const {
    name,
    description,
    howItWorks,
    careInstructions,
    image,
    category
  } = body ?? {};
  const price = Number(body?.price);
  const stock = Number(body?.stock);
  const rawHighlights = body?.highlights;
  const highlights: unknown[] = Array.isArray(rawHighlights)
    ? rawHighlights
    : typeof rawHighlights === "string"
      ? rawHighlights.split(",")
      : [];
  const normalizedHighlights = highlights
    .filter((highlight): highlight is string => typeof highlight === "string")
    .map((highlight) => highlight.trim())
    .filter(Boolean);

  if (
    typeof name !== "string" || !name.trim() ||
    typeof description !== "string" || !description.trim() ||
    typeof howItWorks !== "string" || !howItWorks.trim() ||
    typeof careInstructions !== "string" || !careInstructions.trim() ||
    normalizedHighlights.length === 0 ||
    typeof image !== "string" || !image.trim() ||
    typeof category !== "string" || !category.trim() ||
    !Number.isFinite(price) || price < 0 ||
    !Number.isInteger(stock) || stock < 0
  ) {
    return null;
  }

  return {
    name: name.trim(),
    description: description.trim(),
    howItWorks: howItWorks.trim(),
    highlights: normalizedHighlights,
    careInstructions: careInstructions.trim(),
    image: image.trim(),
    category: category.trim(),
    stock,
    priceCents: Math.round(price * 100),
    keywords: [category.trim().toLowerCase()]
  };
};

// GET /api/products
export const getProducts: RequestHandler<NoParams> = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: 1 });

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: errorMessage(error) });
  }
};

// POST /api/products
export const createProduct: RequestHandler<NoParams, unknown, ProductFormBody | undefined> = async (req, res) => {
  try {
    const productDetails = getProductDetails(req.body);

    if (!productDetails) {
      return res.status(400).json({ message: "Please provide valid product details" } satisfies ErrorResponse);
    }

    const product = await Product.create({
      ...productDetails,
      rating: { stars: 0, count: 0 },
    });

    return res.status(201).json(product);
  } catch (error) {
    if (errorName(error) === "ValidationError") {
      return res.status(400).json({ message: "Please provide valid product details" } satisfies ErrorResponse);
    }

    console.error("Create product failed:", errorMessage(error));
    return res.status(500).json({ message: "Unable to create product" } satisfies ErrorResponse);
  }
};

// PUT /api/products/:productId
export const updateProduct: RequestHandler<ProductParams, unknown, ProductFormBody | undefined> = async (req, res) => {
  try {
    const productDetails = getProductDetails(req.body);

    if (!productDetails) {
      return res.status(400).json({ message: "Please provide valid product details" } satisfies ErrorResponse);
    }

    const product = await Product.findByIdAndUpdate(
      req.params.productId,
      productDetails,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ message: "Product not found" } satisfies ErrorResponse);
    }

    return res.json(product);
  } catch (error) {
    if (errorName(error) === "ValidationError") {
      return res.status(400).json({ message: "Please provide valid product details" } satisfies ErrorResponse);
    }

    console.error("Update product failed:", errorMessage(error));
    return res.status(500).json({ message: "Unable to update product" } satisfies ErrorResponse);
  }
};

// DELETE /api/products/:productId
export const deleteProduct: RequestHandler<ProductParams, DeleteProductResponse | ErrorResponse> = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.productId);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.json({ id: product.id });
  } catch (error) {
    console.error("Delete product failed:", errorMessage(error));
    return res.status(500).json({ message: "Unable to delete product" });
  }
};

// GET /api/delivery-options
export const getDeliveryOptions: RequestHandler<NoParams> = async (req, res) => {
  try {
    const deliveryOptions = await DeliveryOption.find().sort({ createdAt: 1 });

    if (req.query.expand === "estimatedDeliveryTime") {
      const optionsWithDates = deliveryOptions.map((option) => ({
        ...option.toJSON(),
        estimatedDeliveryTimeMs:
          Date.now() + option.deliveryDays * 24 * 60 * 60 * 1000
      }));

      return res.json(optionsWithDates);
    }

    return res.json(deliveryOptions);
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
};
