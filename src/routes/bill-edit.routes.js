import { Router } from 'express';
import {
  getBillEditData,
  handleBillEditRouteError,
  showBillEditForm,
  submitBillEditForm,
} from '../controllers/bill-edit-web.controller.js';

const router = Router();
const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.get('/:token/data', asyncRoute(getBillEditData));
router.post('/:token', asyncRoute(submitBillEditForm));
router.get('/:token', asyncRoute(showBillEditForm));
router.use(handleBillEditRouteError);

export default router;
