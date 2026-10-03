import DeliveryOption from "../models/DeliveryOption.js";
import Product from "../models/Product.js";

const getProductDetails = (body) => {
  const { name, description, image, category } = body ?? {};
  const price = Number(body?.price);
  const stock = Number(body?.stock);

  if (
    typeof name !== "string" || !name.trim() ||
    typeof description !== "string" || !description.trim() ||
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
    image: image.trim(),
    category: category.trim(),
    stock,
    priceCents: Math.round(price * 100),
    keywords: [category.trim().toLowerCase()]
  };
};

// GET /api/products
export const getProducts = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: 1 });
     
    res.json(products);
    console.log(products);
   
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/products
export const createProduct = async (req, res) => {
  try {
    const productDetails = getProductDetails(req.body);

    if (!productDetails) {
      return res.status(400).json({ message: "Please provide valid product details" });
    }

    const product = await Product.create({
      ...productDetails,
      rating: { stars: 0, count: 0 },
    });

    res.status(201).json(product);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: "Please provide valid product details" });
    }

    console.error("Create product failed:", error.message);
    res.status(500).json({ message: "Unable to create product" });
  }
};

// PUT /api/products/:productId
export const updateProduct = async (req, res) => {
  try {
    const productDetails = getProductDetails(req.body);

    if (!productDetails) {
      return res.status(400).json({ message: "Please provide valid product details" });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.productId,
      productDetails,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(product);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: "Please provide valid product details" });
    }

    console.error("Update product failed:", error.message);
    res.status(500).json({ message: "Unable to update product" });
  }
};

// DELETE /api/products/:productId
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.productId);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ id: product.id });
  } catch (error) {
    console.error("Delete product failed:", error.message);
    res.status(500).json({ message: "Unable to delete product" });
  }
};

// GET /api/delivery-options
export const getDeliveryOptions = async (req, res) => {
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

    res.json(deliveryOptions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
