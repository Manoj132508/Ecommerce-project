import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const ratingSchema = new mongoose.Schema(
  {
    stars: { type: Number, required: true },
    count: { type: Number, required: true }
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    _id: { type: String, default: randomUUID },
    image: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    category: { type: String, default: "", trim: true },
    stock: { type: Number, default: 0, min: 0 },
    rating: { type: ratingSchema, required: true },
    priceCents: { type: Number, required: true, min: 0 },
    keywords: { type: [String], default: [] }
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_document, product) => {
        product.id = product._id;
        delete product._id;
      }
    }
  }
);

const Product = mongoose.model("Product", productSchema);

export default Product;
