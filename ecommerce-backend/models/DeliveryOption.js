import mongoose from "mongoose";

const deliveryOptionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    deliveryDays: { type: Number, required: true, min: 0 },
    priceCents: { type: Number, required: true, min: 0 }
  },
  {
    collection: "deliveryOptions",
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_document, option) => {
        option.id = option._id;
        delete option._id;
      }
    }
  }
);

const DeliveryOption = mongoose.model("DeliveryOption", deliveryOptionSchema);

export default DeliveryOption;
