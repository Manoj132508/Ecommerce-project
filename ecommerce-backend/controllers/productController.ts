import type { RequestHandler } from "express";
import type { DeliveryOptionRepository, ProductChanges, ProductRepository } from "../repositories/types.js";
import type { DeleteProductResponse, ErrorResponse } from "../types/api.js";
import { errorMessage, errorName } from "../utils/errors.js";
import { isProductId } from "../utils/identifiers.js";

type NoParams = Record<string, string>;
type ProductParams = { productId: string };

const invalidProductId: ErrorResponse = { message: "Invalid product id" };

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
  /** Optional search keywords (array or comma-separated). Not sent by the Vite form. */
  keywords?: unknown;
}

const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 40;

/**
 * undefined: not sent (create uses the category, update keeps the stored
 * keywords); null: invalid; otherwise trimmed, lower-case, unique keywords.
 */
const parseKeywords = (value: unknown): string[] | null | undefined => {
  if (value === undefined) return undefined;
  const items: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [null];
  if (!items.every((item): item is string => typeof item === "string")) return null;
  const keywords = [...new Set(items.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (keywords.length > MAX_KEYWORDS || keywords.some((keyword) => keyword.length > MAX_KEYWORD_LENGTH)) return null;
  return keywords;
};

const getProductDetails = (body: ProductFormBody | undefined): ProductChanges | null => {
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
  const keywords = parseKeywords(body?.keywords);
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
    !Number.isInteger(stock) || stock < 0 ||
    keywords === null
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
    ...(keywords ? { keywords } : {})
  };
};

export function createProductController(products: ProductRepository, deliveryOptions: DeliveryOptionRepository) {
  // GET /api/products
  const getProducts: RequestHandler<NoParams> = async (req, res) => {
    try {
      res.json(await products.list());
    } catch (error) {
      res.status(500).json({ message: errorMessage(error) });
    }
  };

  // POST /api/products
  const createProduct: RequestHandler<NoParams, unknown, ProductFormBody | undefined> = async (req, res) => {
    try {
      const productDetails = getProductDetails(req.body);

      if (!productDetails) {
        return res.status(400).json({ message: "Please provide valid product details" } satisfies ErrorResponse);
      }

      // Without keywords a new product is found by its category, as before.
      return res.status(201).json(await products.create({
        ...productDetails,
        keywords: productDetails.keywords?.length ? productDetails.keywords : [productDetails.category.toLowerCase()]
      }));
    } catch (error) {
      if (errorName(error) === "ValidationError") {
        return res.status(400).json({ message: "Please provide valid product details" } satisfies ErrorResponse);
      }

      console.error("Create product failed:", errorMessage(error));
      return res.status(500).json({ message: "Unable to create product" } satisfies ErrorResponse);
    }
  };

  // PUT /api/products/:productId
  const updateProduct: RequestHandler<ProductParams, unknown, ProductFormBody | undefined> = async (req, res) => {
    try {
      if (!isProductId(req.params.productId)) {
        return res.status(400).json(invalidProductId);
      }

      const productDetails = getProductDetails(req.body);

      if (!productDetails) {
        return res.status(400).json({ message: "Please provide valid product details" } satisfies ErrorResponse);
      }

      const product = await products.update(req.params.productId, productDetails);

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
  const deleteProduct: RequestHandler<ProductParams, DeleteProductResponse | ErrorResponse> = async (req, res) => {
    try {
      if (!isProductId(req.params.productId)) {
        return res.status(400).json(invalidProductId);
      }

      const deleted = await products.delete(req.params.productId);

      if (!deleted) {
        return res.status(404).json({ message: "Product not found" });
      }

      return res.json({ id: deleted.id });
    } catch (error) {
      console.error("Delete product failed:", errorMessage(error));
      return res.status(500).json({ message: "Unable to delete product" });
    }
  };

  // GET /api/delivery-options
  const getDeliveryOptions: RequestHandler<NoParams> = async (req, res) => {
    try {
      const options = await deliveryOptions.list();

      if (req.query.expand === "estimatedDeliveryTime") {
        const optionsWithDates = options.map((option) => ({
          ...option,
          estimatedDeliveryTimeMs:
            Date.now() + option.deliveryDays * 24 * 60 * 60 * 1000
        }));

        return res.json(optionsWithDates);
      }

      return res.json(options);
    } catch (error) {
      return res.status(500).json({ message: errorMessage(error) });
    }
  };

  return { getProducts, createProduct, updateProduct, deleteProduct, getDeliveryOptions };
}
