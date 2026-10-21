export interface ProductRating {
  stars: number;
  count: number;
}

export interface ProductData {
  id: string;
  image: string;
  name: string;
  description: string;
  howItWorks: string;
  highlights: string[];
  careInstructions: string;
  category: string;
  stock: number;
  rating: ProductRating;
  priceCents: number;
  keywords: string[];
}

export interface ProductFormData {
  name: string;
  price: string;
  description: string;
  howItWorks: string;
  highlights: string;
  careInstructions: string;
  image: string;
  category: string;
  stock: string;
}
