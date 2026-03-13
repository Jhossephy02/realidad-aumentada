import mongoose from 'mongoose';

const analyticsEventSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    path: { type: String, default: '' }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

analyticsEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const AnalyticsEvent = mongoose.models.AnalyticsEvent || mongoose.model('AnalyticsEvent', analyticsEventSchema);

