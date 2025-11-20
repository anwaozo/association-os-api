import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';

function sanitizeValue(value) {
   if (typeof value === "string") {
      return value.replace(/[<>$]/g, "");
   }
   if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
         value[key] = sanitizeValue(value[key]);
      }
   }
   return value;
}

function sanitizeRequest(req, _res, next) {
   sanitizeValue(req.body);
   sanitizeValue(req.params);
   sanitizeValue(req.query);
   next();
}

export const applySecurityMiddleware = (app) => {
   app.use(helmet());
   app.use(
      cors({
         origin: "*",
         methods: ["GET", "POST", "PUT", "DELETE"],
      })
   );
   app.use(sanitizeRequest);
   app.use(
      rateLimit({
         windowMs: 15 * 60 * 1000,
         max: 100,
         message: "Too many requests, please try again later.",
      })
   );
};