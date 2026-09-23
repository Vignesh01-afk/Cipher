import { Router } from 'express';
import { authRouter } from './auth';
import { usersRouter } from './users';
import { notesRouter } from './notes';
import { sharedRouter } from './shared';
import { auditRouter } from './audit';
import { filesRouter } from './files';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/notes', notesRouter);
apiRouter.use('/shared', sharedRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/files', filesRouter);
