import { API_ERROR_CODES } from "@uchiha-radius/contracts";

export class AppError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message = "العنصر غير موجود") {
  return new AppError(404, API_ERROR_CODES.NOT_FOUND, message);
}

export function forbidden(message = "لا تملك الصلاحية المطلوبة") {
  return new AppError(403, API_ERROR_CODES.FORBIDDEN, message);
}

export function subscriptionRequired() {
  return new AppError(402, API_ERROR_CODES.SUBSCRIPTION_REQUIRED, "يلزم اشتراك فعّال لتنفيذ هذه العملية");
}

export function validationError(message, details) {
  return new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, message, details);
}
