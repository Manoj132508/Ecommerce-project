// MongoDB implementations: the queries the controllers ran before Phase 3C,
// moved behind the repository interfaces without changing behaviour.
// Products and orders are returned as Mongoose documents, so their JSON
// (key order included) is exactly what the API produced before.
// Cart and order code looks up products and delivery options through those
// domains' repositories, so either may already be served by PostgreSQL.
import CartItem from "../models/CartItem.js";
import DeliveryOption from "../models/DeliveryOption.js";
import Order, { type OrderDocument } from "../models/Order.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import type { CustomerDetails } from "../types/api.js";
import type {
  AuthUser,
  CartLineRecord,
  CartOwner,
  CartRepository,
  CheckoutResult,
  DeliveryOptionRecord,
  DeliveryOptionRepository,
  OrderRepository,
  ProductDetails,
  ProductRecord,
  ProductRepository,
  StatusChangeResult,
  UserRepository,
  Viewer,
} from "./types.js";
import { verifyWithoutAccount } from "../utils/passwords.js";

type DeliveryOptionDocument = InstanceType<typeof DeliveryOption>;
type CartItemDocument = InstanceType<typeof CartItem>;

// Same field order as the model's toJSON output (verified against live data).
const toDeliveryOption = (option: DeliveryOptionDocument): DeliveryOptionRecord => ({
  deliveryDays: option.deliveryDays,
  priceCents: option.priceCents,
  createdAt: option.createdAt,
  updatedAt: option.updatedAt,
  id: option._id,
});

const toCartLine = (line: CartItemDocument): CartLineRecord => ({
  productId: line.productId,
  quantity: line.quantity,
  deliveryOptionId: line.deliveryOptionId,
  createdAt: line.createdAt,
  updatedAt: line.updatedAt,
  id: String(line._id),
});

export class MongoDeliveryOptionRepository implements DeliveryOptionRepository {
  readonly source = "mongo";

  async list() {
    return (await DeliveryOption.find().sort({ createdAt: 1 })).map(toDeliveryOption);
  }

  async findById(id: string) {
    const option = await DeliveryOption.findById(id);
    return option ? toDeliveryOption(option) : null;
  }
}

export class MongoProductRepository implements ProductRepository {
  readonly source = "mongo";

  async list(): Promise<ProductRecord[]> {
    return Product.find().sort({ createdAt: 1 });
  }

  async findById(id: string): Promise<ProductRecord | null> {
    return Product.findById(id);
  }

  async create(details: ProductDetails): Promise<ProductRecord> {
    return Product.create({ ...details, rating: { stars: 0, count: 0 } });
  }

  async update(id: string, details: ProductDetails): Promise<ProductRecord | null> {
    return Product.findByIdAndUpdate(id, details, { new: true, runValidators: true });
  }

  async delete(id: string) {
    const product = await Product.findByIdAndDelete(id);
    return product ? { id: product.id } : null;
  }
}

export class MongoUserRepository implements UserRepository {
  readonly source = "mongo";

  async findById(id: string): Promise<AuthUser | null> {
    return User.findById(id).select("-password");
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    return User.findOne({ email });
  }

  async authenticate(email: string, password: string): Promise<AuthUser | null> {
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return verifyWithoutAccount(password).then(() => null);
    }
    if (!(await user.matchPassword(password))) {
      return null;
    }
    return user;
  }

  async create(details: { name: string; email: string; password: string }): Promise<AuthUser> {
    return User.create(details);
  }
}

/** The legacy shared cart: one cart for everyone (owner is ignored). */
export class MongoCartRepository implements CartRepository {
  readonly source = "mongo";
  readonly ownership = "shared";

  async list(_owner: CartOwner) {
    return (await CartItem.find().sort({ createdAt: 1 })).map(toCartLine);
  }

  async find(_owner: CartOwner, productId: string) {
    const line = await CartItem.findOne({ productId });
    return line ? toCartLine(line) : null;
  }

  async add(_owner: CartOwner, productId: string, quantity: number) {
    let line = await CartItem.findOne({ productId });

    if (line) {
      line.quantity += quantity;
      await line.save();
    } else {
      line = await CartItem.create({
        productId,
        quantity,
        deliveryOptionId: "1"
      });
    }

    return toCartLine(line);
  }

  async update(_owner: CartOwner, productId: string, changes: { quantity?: number; deliveryOptionId?: string }) {
    const line = await CartItem.findOne({ productId });
    if (!line) return null;

    if (changes.quantity !== undefined) line.quantity = changes.quantity;
    if (changes.deliveryOptionId !== undefined) line.deliveryOptionId = changes.deliveryOptionId;
    await line.save();
    return toCartLine(line);
  }

  async remove(_owner: CartOwner, productId: string) {
    const line = await CartItem.findOne({ productId });
    if (!line) return false;

    await line.deleteOne();
    return true;
  }
}

export class MongoOrderRepository implements OrderRepository {
  readonly source = "mongo";

  constructor(
    private readonly products: ProductRepository,
    private readonly deliveryOptions: DeliveryOptionRepository,
  ) {}

  private async addProductDetails(order: OrderDocument) {
    const products = await Promise.all(
      order.products.map(async (orderProduct) => {
        const storedOrderProduct = orderProduct.toObject();

        if (storedOrderProduct.product) {
          return storedOrderProduct;
        }

        // Older orders created before product snapshots still get a best-effort lookup.
        const legacyProduct = await this.products.findById(orderProduct.productId);

        return {
          ...storedOrderProduct,
          product: legacyProduct
        };
      })
    );

    return { ...order.toJSON(), products };
  }

  async list(viewer: Viewer, expandProducts: boolean): Promise<unknown[]> {
    const filter = viewer.isAdmin ? {} : { userId: viewer.id };
    const orders = await Order.find(filter).sort({ orderTimeMs: -1 });
    return expandProducts ? Promise.all(orders.map((order) => this.addProductDetails(order))) : orders;
  }

  async get(orderId: string, viewer: Viewer, expandProducts: boolean): Promise<unknown> {
    const order = await Order.findById(orderId);

    if (!order || (!viewer.isAdmin && order.userId !== viewer.id)) {
      return null;
    }

    return expandProducts ? this.addProductDetails(order) : order;
  }

  async checkout(_owner: CartOwner, user: AuthUser, customer: CustomerDetails, _idempotencyKey?: string): Promise<CheckoutResult> {
    const cartItems = await CartItem.find().sort({ createdAt: 1 });

    if (cartItems.length === 0) {
      return { kind: "empty" };
    }

    const cartDetails = await Promise.all(
      cartItems.map(async (cartItem) => {
        const [product, deliveryOption] = await Promise.all([
          this.products.findById(cartItem.productId),
          this.deliveryOptions.findById(cartItem.deliveryOptionId)
        ]);

        return { cartItem, product, deliveryOption };
      })
    );

    const unavailableProductIds = cartDetails
      .filter(({ product }) => !product)
      .map(({ cartItem }) => cartItem.productId);

    if (unavailableProductIds.length > 0) {
      return { kind: "unavailable", productIds: unavailableProductIds };
    }

    if (cartDetails.some(({ deliveryOption }) => !deliveryOption)) {
      return { kind: "invalid-delivery" };
    }

    // Both checks above guarantee every line has a product and a delivery
    // option; this narrows the types without dropping or reordering lines.
    const checkedDetails = cartDetails.flatMap(({ cartItem, product, deliveryOption }) => (
      product && deliveryOption ? [{ cartItem, product, deliveryOption }] : []
    ));

    let totalCostBeforeTaxCents = 0;

    const products = checkedDetails.map(({ cartItem, product, deliveryOption }) => {
      totalCostBeforeTaxCents +=
        product.priceCents * cartItem.quantity + deliveryOption.priceCents;

      return {
        productId: cartItem.productId,
        product: {
          id: product.id,
          image: product.image,
          name: product.name,
          priceCents: product.priceCents,
          description: product.description,
          category: product.category
        },
        quantity: cartItem.quantity,
        estimatedDeliveryTimeMs:
          Date.now() + deliveryOption.deliveryDays * 24 * 60 * 60 * 1000
      };
    });

    const order = await Order.create({
      userId: user.id,
      customer,
      orderTimeMs: Date.now(),
      totalCostCents: Math.round(totalCostBeforeTaxCents * 1.1),
      products
    });

    await CartItem.deleteMany();
    return { kind: "placed", order };
  }

  async changeStatus(): Promise<StatusChangeResult> {
    // Legacy MongoDB orders have no status model.
    return { kind: "unsupported" };
  }
}
