import mongoose from 'mongoose';
import { newArId } from '../utils/ids.js';

const arModelSchema = new mongoose.Schema(
  {
    arId: { type: String, required: true, unique: true, default: newArId },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price: { type: Number, default: 0 },
    glb: { type: String, required: true },
    markerImage: { type: String, required: true },
    markerPattern: { type: String, default: '' },
    markerPatt: { type: String, default: '' },
    markerPreview: { type: String, default: '' },
    markerMeta: { type: mongoose.Schema.Types.Mixed, default: null },
    barcodeValue: { type: Number, default: null },
    targetIndex: { type: Number, default: null },
    scale: { type: String, default: '1 1 1' },
    rotation: { type: String, default: '0 0 0' },
    position: { type: String, default: '0 0 0' },
    details: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

export const ArModel = mongoose.models.ArModel || mongoose.model('ArModel', arModelSchema);
