import mongoose from 'mongoose';

const analyticsSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true, index: true },
    hits: { type: Number, default: 1 },
    lastPath: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    ipHash: { type: String, default: '' }
  },
  { timestamps: false }
);

export const AnalyticsSession =
  mongoose.models.AnalyticsSession || mongoose.model('AnalyticsSession', analyticsSessionSchema);

