// Makes `req.userId` available on Express' Request type after authentication.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

export {};
