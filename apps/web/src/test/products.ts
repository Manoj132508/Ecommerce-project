import type { Product } from "@/features/catalog/product";

const base = {
  howItWorks: "Use it.",
  careInstructions: "Keep it clean.",
  stock: 0,
};

/** Shapes and image paths as in the real catalogue (files exist in public/images/products). */
export const PRODUCTS: Product[] = [
  { ...base, id: "e43638ce-6aa0-4b85-b27f-e1d07eb678c6", image: "images/products/athletic-skateboard-shoes-gray.jpg", name: "Athletic Skateboard Shoes", description: "Grippy shoes.", highlights: ["Rubber sole"], category: "Footwear", rating: { stars: 4.5, count: 87 }, priceCents: 3390, keywords: ["shoes", "sports"] },
  { ...base, id: "15b6fc6f-327a-4ec4-896f-486349e85a3d", image: "images/products/bath-towel-set-gray-rosewood.jpg", name: "Bath Towel Set", description: "Soft towels.", highlights: ["Cotton"], category: "Home", rating: { stars: 4, count: 127 }, priceCents: 2299, keywords: ["bathroom", "towels"] },
  { ...base, id: "83d4ca15-0f35-48f5-b7a3-1ea210004f2e", image: "images/products/black-and-silver-espresso-maker.jpg", name: "Espresso Maker", description: "Strong coffee.", highlights: ["Steel"], category: "Kitchen", rating: { stars: 5, count: 3 }, priceCents: 8999, keywords: ["coffee", "appliances"] },
  { ...base, id: "54e0eccd-8f36-462b-b68a-8182611d9add", image: "images/products/round-sunglasses-gold.jpg", name: "Round Sunglasses", description: "Gold frame.", highlights: [], category: "Accessories", rating: { stars: 3.5, count: 30 }, priceCents: 1560, keywords: ["sunglasses"] },
  { ...base, id: "3ebe75dc-64d2-4137-8860-1f5a963e534b", image: "images/products/straw-sunhat.jpg", name: "Straw Sunhat", description: "Wide brim.", highlights: ["Straw"], category: "Accessories", rating: { stars: 4, count: 215 }, priceCents: 2200, keywords: ["hats", "summer"] },
];
