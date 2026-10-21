import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, unique: true },
    quantity: { type: Number, required: true, min: 1 },
    deliveryOptionId: { type: String, required: true }
  },
  {
    collection: "cartItems",
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_document, cartItem: Record<string, unknown>) => {
        cartItem.id = String(cartItem._id);
        delete cartItem._id;
      }
    }
  }
);

const CartItem = mongoose.model("CartItem", cartItemSchema);

export default CartItem;
