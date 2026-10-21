import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/db.js";
import Product from "../models/Product.js";
import { getProductCategory } from "../utils/productInformation.js";

dotenv.config();

async function populateProductCategories() {
  await connectDB();

  const products = await Product.find();
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const product of products) {
    if (product.category?.trim()) {
      unchangedCount += 1;
      continue;
    }

    await Product.updateOne(
      { _id: product.id },
      { $set: { category: getProductCategory(product) } }
    );
    updatedCount += 1;
  }

  console.log(`Product categories updated: ${updatedCount}`);
  console.log(`Products already categorised: ${unchangedCount}`);
  console.log(`Total products checked: ${products.length}`);
}

try {
  await populateProductCategories();
} catch (error) {
  console.error(`Product category migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
