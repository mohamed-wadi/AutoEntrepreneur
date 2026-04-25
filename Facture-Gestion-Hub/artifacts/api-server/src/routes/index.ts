import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import clientsRouter from "./clients";
import invoicesRouter from "./invoices";
import declarationsRouter from "./declarations";
import declarationDocumentsRouter from "./declaration-documents";
import statsRouter from "./stats";
import storageRouter from "./storage";
import catalogsRouter from "./catalogs";
import globalFilesRouter from "./global-files";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(clientsRouter);
router.use(invoicesRouter);
router.use(declarationsRouter);
router.use(declarationDocumentsRouter);
router.use(statsRouter);
router.use(storageRouter);
router.use(catalogsRouter);
router.use(globalFilesRouter);

export default router;
