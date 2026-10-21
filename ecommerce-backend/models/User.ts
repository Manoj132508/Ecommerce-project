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
      transform: (_document, user: Record<string, unknown>) => {
        delete user.password;
      }
    },
    methods: {
      async matchPassword(password: string): Promise<boolean> {
        if (!this.password) {
          return false;
        }

        return bcrypt.compare(password, this.password);
      }
    }
  }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  if (Buffer.byteLength(this.password, "utf8") > 72) {
    // invalidate() builds the same ValidationError(this) that addError produced.
    throw this.invalidate("password", "Password must be no more than 72 bytes");
  }

  this.password = await bcrypt.hash(this.password, 12);
});

const User = mongoose.model("User", userSchema);

export type UserDocument = InstanceType<typeof User>;

export default User;

