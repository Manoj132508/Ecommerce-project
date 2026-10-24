import mongoose from "mongoose";

const connectDB = async (): Promise<void> => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  // Fail fast when no server is reachable (the driver's default waits 30 s per
  // operation); readiness (health.ts) reports the outage meanwhile.
  const connection = await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });

  console.log(`MongoDB connected: ${connection.connection.name}`);
};

export default connectDB;
