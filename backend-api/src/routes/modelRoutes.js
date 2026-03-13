import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuthIfEnabled } from '../middleware/auth.js';
import { uploadArModelFiles, uploadModelFile, uploadMarkerFile } from '../middleware/uploads.js';
import {
  listModels,
  getModel,
  createModel,
  updateModel,
  deleteModel,
  listCatalog,
  listArObjects,
  uploadModelOnly,
  uploadMarkerOnly,
  createProduct,
  updateProduct,
  deleteProduct,
  replaceCatalog
} from '../controllers/modelController.js';
import { uploadTargets, getTargets } from '../controllers/targetsController.js';
import { getUploadsStats, cleanupUploads } from '../controllers/uploadsController.js';
import { getHourly, getSummary, listSessions, trackUsage } from '../controllers/analyticsController.js';

export const modelRoutes = Router();

modelRoutes.get('/models', asyncHandler(listModels));
modelRoutes.get('/models/:arId', asyncHandler(getModel));
modelRoutes.post('/models', requireAuthIfEnabled, uploadArModelFiles.fields([{ name: 'glb', maxCount: 1 }, { name: 'marker', maxCount: 1 }]), asyncHandler(createModel));
modelRoutes.put('/models/:arId', requireAuthIfEnabled, uploadArModelFiles.fields([{ name: 'glb', maxCount: 1 }, { name: 'marker', maxCount: 1 }]), asyncHandler(updateModel));
modelRoutes.delete('/models/:arId', requireAuthIfEnabled, asyncHandler(deleteModel));

modelRoutes.get('/catalog', asyncHandler(listCatalog));
modelRoutes.put('/catalog', requireAuthIfEnabled, asyncHandler(replaceCatalog));
modelRoutes.get('/ar-objects', asyncHandler(listArObjects));
modelRoutes.post('/products', requireAuthIfEnabled, asyncHandler(createProduct));
modelRoutes.put('/products/:id', requireAuthIfEnabled, asyncHandler(updateProduct));
modelRoutes.delete('/products/:id', requireAuthIfEnabled, asyncHandler(deleteProduct));

modelRoutes.post('/upload/model', requireAuthIfEnabled, uploadModelFile.single('file'), asyncHandler(uploadModelOnly));
modelRoutes.post('/upload/marker', requireAuthIfEnabled, uploadMarkerFile.single('file'), asyncHandler(uploadMarkerOnly));

modelRoutes.post('/upload/targets', requireAuthIfEnabled, asyncHandler(uploadTargets));
modelRoutes.get('/targets.mind', asyncHandler(getTargets));

modelRoutes.get('/uploads/stats', requireAuthIfEnabled, asyncHandler(getUploadsStats));
modelRoutes.post('/uploads/cleanup', requireAuthIfEnabled, asyncHandler(cleanupUploads));

modelRoutes.post('/analytics/track', asyncHandler(trackUsage));
modelRoutes.get('/analytics/summary', requireAuthIfEnabled, asyncHandler(getSummary));
modelRoutes.get('/analytics/sessions', requireAuthIfEnabled, asyncHandler(listSessions));
modelRoutes.get('/analytics/hourly', requireAuthIfEnabled, asyncHandler(getHourly));
