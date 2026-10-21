import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/db.js";
import Product from "../models/Product.js";
import { errorMessage } from "../utils/errors.js";
import { getProductInformation, type ProductInformation } from "../utils/productInformation.js";

dotenv.config();

async function populateProductDescriptions() {
  await connectDB();

  const products = await Product.find();
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const product of products) {
    const generatedInformation = getProductInformation(product);
    const updates: Partial<ProductInformation> = {};

    if (!product.description?.trim()) {
      updates.description = generatedInformation.description;
    }

    if (!product.howItWorks?.trim()) {
      updates.howItWorks = generatedInformation.howItWorks;
    }

    if (!Array.isArray(product.highlights) || product.highlights.length === 0) {
      updates.highlights = generatedInformation.highlights;
    }

    if (!product.careInstructions?.trim()) {
      updates.careInstructions = generatedInformation.careInstructions;
    }

    if (Object.keys(updates).length === 0) {
      unchangedCount += 1;
      continue;
    }

    await Product.updateOne({ _id: product.id }, { $set: updates });
    updatedCount += 1;
  }

  console.log(`Product descriptions updated: ${updatedCount}`);
  console.log(`Products already complete: ${unchangedCount}`);
  console.log(`Total products checked: ${products.length}`);
}

try {
  await populateProductDescriptions();
} catch (error) {
  console.error(`Product description migration failed: ${String(errorMessage(error))}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
