import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    password: { type: String, required: true, minlength: 8, select: false },
    isAdmin: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_document, user) => {
        delete user.password;
      }
    }
  }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  if (Buffer.byteLength(this.password, "utf8") > 72) {
    const error = new mongoose.Error.ValidationError(this);
    error.addError("password", new mongoose.Error.ValidatorError({
      path: "password",
      message: "Password must be no more than 72 bytes"
    }));
    throw error;
  }

  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.matchPassword = async function (password) {
  if (!this.password) {
    return false;
  }

  return bcrypt.compare(password, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
